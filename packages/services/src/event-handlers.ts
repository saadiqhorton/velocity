import { and, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import { comments, issueLabels, issues, labels, projects, statuses, subscriptions, teams, users } from '@velocity/schema';
import type { WebhookEventType } from '@velocity/schema';
import { processOutboxBatch } from '@velocity/events';
import type { OutboxEvent } from '@velocity/events';
import { tables } from '@velocity/schema';
import { ServiceBase } from './base';
import type { DbOrTx } from './db';
import type { NotificationDraft, NotificationService } from './notifications';
import type { WebhookService } from './webhooks';
import { markdownToPlainText } from './lib/markdown';

/**
 * Exactly-once side effects of domain events (SPEC §5.5, §5.6, §3.11, §6.4):
 * notification fan-out and webhook delivery creation commit atomically with the outbox
 * row's `published_at`; delivery jobs are enqueued after commit.
 */
export class EventProcessor extends ServiceBase {
  private notifications!: NotificationService;
  private webhooks!: WebhookService;
  bind(notifications: NotificationService, webhooks: WebhookService): void {
    this.notifications = notifications;
    this.webhooks = webhooks;
  }

  /** Drain until empty. Returns number of processed events. */
  async drain(): Promise<number> {
    let total = 0;
    for (let i = 0; i < 50; i++) {
      const toEnqueue: string[] = [];
      const n = await processOutboxBatch(this.pool, async (client: PoolClient, events: OutboxEvent[]) => {
        const exec = drizzle(client, { schema: tables });
        for (const ev of events) {
          try {
            toEnqueue.push(...(await this.handle(exec, ev)));
          } catch (err) {
            // A poison event must not block the outbox; log and continue.
            this.logger.error({ err, eventId: ev.id, topic: ev.topic }, 'event handler failed');
          }
        }
      });
      for (const id of toEnqueue) await this.jobs.send('webhooks', { type: 'deliver', deliveryId: id });
      total += n;
      if (n === 0) break;
    }
    return total;
  }

  private async handle(exec: DbOrTx, ev: OutboxEvent): Promise<string[]> {
    // Bulk imports announce themselves once via import.completed — never per issue/comment.
    const actor = (ev.payload as { actor?: { kind?: string } }).actor;
    if (actor?.kind === 'import') return [];
    const drafts: NotificationDraft[] = [];
    const deliveries: string[] = [];
    const hook = async (type: WebhookEventType, data: Record<string, unknown>) => {
      deliveries.push(...(await this.webhooks.createDeliveries(exec, type, data)));
    };

    switch (ev.topic) {
      case 'issue.created': {
        const snap = await issueSnapshot(exec, ev.payload.issueId, this.config.appUrl);
        if (!snap) break;
        const actorId = ev.payload.actor.userId;
        if (snap.assigneeId && snap.assigneeId !== actorId) {
          drafts.push({ userId: snap.assigneeId, issueId: snap.id, actorUserId: actorId, type: 'assigned', payload: notifPayload(snap) });
        }
        await hook('issue.created', { issue: snap.public, actor: ev.payload.actor });
        break;
      }
      case 'issue.updated': {
        const snap = await issueSnapshot(exec, ev.payload.issueId, this.config.appUrl);
        if (!snap) break;
        const { changes, actor } = ev.payload;
        const actorId = actor.userId;
        const subs = await subscriberIds(exec, snap.id);
        if (changes.assigneeId && snap.assigneeId && snap.assigneeId !== actorId) {
          drafts.push({ userId: snap.assigneeId, issueId: snap.id, actorUserId: actorId, type: 'assigned', payload: notifPayload(snap) });
        }
        if (changes.statusId) {
          const names = await statusNames(exec, [changes.statusId.from as string, changes.statusId.to as string]);
          for (const u of subs) {
            if (u === actorId) continue;
            drafts.push({
              userId: u,
              issueId: snap.id,
              actorUserId: actorId,
              type: 'status_changed',
              payload: { ...notifPayload(snap), from: names.get(changes.statusId.from as string) ?? null, to: names.get(changes.statusId.to as string) ?? null },
            });
          }
        }
        if (changes.priority) {
          for (const u of subs) {
            if (u === actorId) continue;
            drafts.push({ userId: u, issueId: snap.id, actorUserId: actorId, type: 'priority_changed', payload: { ...notifPayload(snap), from: changes.priority.from, to: changes.priority.to } });
          }
        }
        const fields = ev.payload.changedFields.filter((f) => f !== 'sortOrder');
        if (fields.length) {
          await hook('issue.updated', { issue: snap.public, changedFields: fields, changes: publicChanges(changes), actor });
          if (changes.statusId) await hook('issue.status_changed', { issue: snap.public, from: changes.statusId.from, to: changes.statusId.to, actor });
          if (changes.assigneeId && snap.assigneeId) await hook('issue.assigned', { issue: snap.public, assigneeId: snap.assigneeId, actor });
        }
        break;
      }
      case 'comment.created': {
        const [c] = await exec.select().from(comments).where(eq(comments.id, ev.payload.commentId));
        const snap = await issueSnapshot(exec, ev.payload.issueId, this.config.appUrl);
        if (!c || !snap) break;
        const actorId = ev.payload.actor.userId;
        const excerpt = markdownToPlainText(c.bodyMd, 160);
        const mentioned = new Set(ev.payload.mentions);
        for (const u of mentioned) {
          if (u === actorId) continue;
          drafts.push({ userId: u, issueId: snap.id, actorUserId: actorId, type: 'mentioned', payload: { ...notifPayload(snap), commentId: c.id, excerpt } });
        }
        for (const u of await subscriberIds(exec, snap.id)) {
          if (u === actorId || mentioned.has(u)) continue;
          drafts.push({ userId: u, issueId: snap.id, actorUserId: actorId, type: 'comment', payload: { ...notifPayload(snap), commentId: c.id, excerpt } });
        }
        await hook('comment.created', {
          comment: { id: c.id, issueId: c.issueId, authorId: c.authorId, bodyMd: c.bodyMd, createdAt: c.createdAt.toISOString() },
          issue: snap.public,
          actor: ev.payload.actor,
        });
        break;
      }
      case 'relation.created': {
        const actorId = ev.payload.actor.userId;
        for (const [issueId, otherId] of [
          [ev.payload.sourceIssueId, ev.payload.targetIssueId],
          [ev.payload.targetIssueId, ev.payload.sourceIssueId],
        ] as const) {
          const snap = await issueSnapshot(exec, issueId, this.config.appUrl);
          const other = await issueSnapshot(exec, otherId, this.config.appUrl);
          if (!snap || !other) continue;
          for (const u of await subscriberIds(exec, issueId)) {
            if (u === actorId) continue;
            drafts.push({
              userId: u,
              issueId,
              actorUserId: actorId,
              type: 'relation_added',
              payload: { ...notifPayload(snap), relationType: ev.payload.type, direction: issueId === ev.payload.sourceIssueId ? 'out' : 'in', otherIdentifier: other.identifier, otherTitle: other.title },
            });
          }
        }
        break;
      }
      case 'github.linked': {
        // state: open | draft | merged | closed | review_requested | changes_requested | commit
        // Closed-unmerged PRs and commits are activity-only (SPEC §6.5.2).
        if (ev.payload.state === 'closed' || ev.payload.state === 'commit') break;
        const snap = await issueSnapshot(exec, ev.payload.issueId, this.config.appUrl);
        if (!snap) break;
        const type =
          ev.payload.state === 'merged'
            ? 'github_pr_merged'
            : ev.payload.state === 'review_requested' || ev.payload.state === 'changes_requested'
              ? 'github_review'
              : 'github_pr_linked';
        const recipients = new Set([snap.assigneeId, ...(await subscriberIds(exec, snap.id))].filter((x): x is string => Boolean(x)));
        for (const u of recipients) {
          drafts.push({ userId: u, issueId: snap.id, actorUserId: null, type, payload: { ...notifPayload(snap), repo: ev.payload.repo, prNumber: ev.payload.prNumber, state: ev.payload.state } });
        }
        break;
      }
      case 'cycle.started':
        await hook('cycle.started', { cycleId: ev.payload.cycleId, teamId: ev.payload.teamId, number: ev.payload.number });
        break;
      case 'cycle.closed':
        await hook('cycle.closed', { cycleId: ev.payload.cycleId, teamId: ev.payload.teamId, number: ev.payload.number, stats: ev.payload.stats });
        break;
      case 'project.created':
      case 'project.updated': {
        const [p] = await exec.select().from(projects).where(eq(projects.id, ev.payload.projectId));
        if (p) {
          await hook('project.updated', {
            project: { id: p.id, name: p.name, status: p.status, health: p.health, targetDate: p.targetDate, progress: { done: p.progressDone, total: p.progressTotal } },
            changedFields: ev.topic === 'project.updated' ? ev.payload.changedFields : ['created'],
            actor: ev.payload.actor,
          });
        }
        break;
      }
      case 'import.completed':
        await hook('import.completed', { runId: ev.payload.runId, status: ev.payload.status, counts: ev.payload.counts });
        break;
      default:
        break;
    }
    if (drafts.length) await this.notifications.createMany(exec, drafts);
    return deliveries;
  }
}

async function subscriberIds(exec: DbOrTx, issueId: string): Promise<string[]> {
  const rows = await exec
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(and(eq(subscriptions.issueId, issueId), isNull(users.deletedAt), isNull(users.suspendedAt)));
  return rows.map((r) => r.userId);
}

async function statusNames(exec: DbOrTx, ids: string[]): Promise<Map<string, string>> {
  const valid = ids.filter(Boolean);
  if (!valid.length) return new Map();
  const rows = await exec.select({ id: statuses.id, name: statuses.name }).from(statuses).where(inArray(statuses.id, valid));
  return new Map(rows.map((r) => [r.id, r.name]));
}

interface IssueSnapshot {
  id: string;
  identifier: string;
  title: string;
  assigneeId: string | null;
  public: Record<string, unknown>;
}

/** Public issue representation for webhook payloads (no internal search vectors etc.). */
export async function issueSnapshot(exec: DbOrTx, issueId: string, appUrl: string): Promise<IssueSnapshot | null> {
  const [row] = await exec
    .select({ i: issues, t: teams, s: statuses })
    .from(issues)
    .innerJoin(teams, eq(teams.id, issues.teamId))
    .innerJoin(statuses, eq(statuses.id, issues.statusId))
    .where(eq(issues.id, issueId));
  if (!row) return null;
  const labelRows = await exec
    .select({ name: labels.name })
    .from(issueLabels)
    .innerJoin(labels, eq(labels.id, issueLabels.labelId))
    .where(eq(issueLabels.issueId, issueId));
  const [assignee] = row.i.assigneeId
    ? await exec.select({ username: users.username, name: users.name }).from(users).where(eq(users.id, row.i.assigneeId))
    : [];
  const identifier = `${row.t.key}-${row.i.number}`;
  return {
    id: row.i.id,
    identifier,
    title: row.i.title,
    assigneeId: row.i.assigneeId,
    public: {
      id: row.i.id,
      identifier,
      title: row.i.title,
      url: `${appUrl.replace(/\/$/, '')}/issue/${row.i.id}`,
      team: { id: row.t.id, key: row.t.key, name: row.t.name },
      status: { id: row.s.id, name: row.s.name, category: row.s.category },
      priority: row.i.priority,
      estimate: row.i.estimate,
      assignee: assignee ? { id: row.i.assigneeId, username: assignee.username, name: assignee.name } : null,
      labels: labelRows.map((l) => l.name),
      projectId: row.i.projectId,
      cycleId: row.i.cycleId,
      parentId: row.i.parentId,
      createdAt: row.i.createdAt.toISOString(),
      updatedAt: row.i.updatedAt.toISOString(),
      completedAt: row.i.completedAt?.toISOString() ?? null,
    },
  };
}

function notifPayload(snap: IssueSnapshot): Record<string, unknown> {
  return { identifier: snap.identifier, title: snap.title };
}

function publicChanges(changes: Record<string, { from: unknown; to: unknown }>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(changes)) out[k] = k === 'descriptionMd' ? { from: null, to: null } : v;
  return out;
}
