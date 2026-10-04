import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { OutboxListener } from '@velocity/events';
import type { OutboxEvent } from '@velocity/events';
import type { VelocityPubSub, WorkspaceEventPayload } from '@velocity/graphql';
import { outboxLag } from './metrics';

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Outbox → in-process pubsub fan-out (SPEC §5.5 step 2): ids only, never bodies. */
export function routeEvent(pubsub: VelocityPubSub, ev: OutboxEvent): void {
  const p = ev.payload as Record<string, unknown>;
  const issueId = str(p.issueId);
  const ws: WorkspaceEventPayload = {
    topic: ev.topic,
    issueId,
    teamId: str(p.teamId) ?? str(p.toTeamId),
    projectId: str(p.projectId),
    entityId: str(p.commentId) ?? str(p.cycleId) ?? str(p.labelId) ?? str(p.viewId) ?? str(p.runId) ?? str(p.relationId) ?? issueId,
    changedFields: Array.isArray(p.changedFields) ? (p.changedFields as string[]) : [],
    actorUserId: str((p.actor as { userId?: unknown } | undefined)?.userId),
  };
  switch (ev.topic) {
    case 'issue.created':
      pubsub.publish('issue:created', { issueId: issueId!, teamId: ws.teamId ?? '' });
      break;
    case 'issue.updated':
    case 'issue.archived':
    case 'issue.trashed':
    case 'issue.deleted':
    case 'issue.moved':
    case 'comment.created':
    case 'comment.updated':
    case 'comment.deleted':
    case 'github.linked':
      if (issueId) pubsub.publish('issue:updated', issueId, { issueId });
      break;
    case 'relation.created':
    case 'relation.deleted': {
      const a = str(p.sourceIssueId);
      const b = str(p.targetIssueId);
      if (a) pubsub.publish('issue:updated', a, { issueId: a });
      if (b) pubsub.publish('issue:updated', b, { issueId: b });
      break;
    }
    case 'notification.created':
      pubsub.publish('notification:created', String(p.userId), { notificationId: String(p.notificationId) });
      return; // per-user only — don't broadcast
    case 'import.progress':
    case 'import.completed':
      pubsub.publish('import:progress', String(p.runId), { runId: String(p.runId) });
      break;
    case 'view.updated':
      return; // personal; owner refetches on mutation
    default:
      break;
  }
  pubsub.publish('workspace:event', ws);
}

export async function startRealtime(pool: Pool, pubsub: VelocityPubSub, logger: Logger, onEvent?: () => void): Promise<OutboxListener> {
  const listener = new OutboxListener(pool, { onError: (err) => logger.warn({ err }, 'outbox listener error') });
  listener.subscribe((ev) => {
    routeEvent(pubsub, ev);
    onEvent?.();
  });
  await listener.start();
  const lagTimer = setInterval(async () => {
    try {
      const r = await pool.query<{ lag: number | null }>(
        `select extract(epoch from now() - min(created_at))::float as lag from event_outbox where published_at is null`,
      );
      outboxLag.set(r.rows[0]?.lag ?? 0);
    } catch {
      /* best-effort */
    }
  }, 10_000);
  lagTimer.unref();
  return listener;
}
