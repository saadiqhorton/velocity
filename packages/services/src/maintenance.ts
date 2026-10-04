import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { attachments, issues, sessions, workspace } from '@velocity/schema';
import { ServiceBase } from './base';
import { systemActor } from './context';
import type { IssueService } from './issues';
import type { WebhookService } from './webhooks';

const DAY = 86_400_000;

/**
 * Retention & housekeeping (SPEC §5.6 `maintenance`, §7.2): trash purge (30d), workspace
 * deletion (7d), session sweep, outbox (7d), webhook deliveries (30d), audit (1y default).
 * Every step is idempotent.
 */
export class MaintenanceService extends ServiceBase {
  private issueService!: IssueService;
  private webhookService!: WebhookService;
  bind(issueService: IssueService, webhookService: WebhookService): void {
    this.issueService = issueService;
    this.webhookService = webhookService;
  }

  async daily(opts: { auditRetentionDays?: number } = {}): Promise<Record<string, number>> {
    const now = this.now();
    const out: Record<string, number> = {};
    out.trashPurged = await this.purgeTrash(now);
    out.sessionsSwept = (
      await this.db
        .delete(sessions)
        .where(sql`${sessions.expiresAt} < ${new Date(now.getTime() - DAY)} or (${sessions.revokedAt} is not null and ${sessions.revokedAt} < ${new Date(now.getTime() - 7 * DAY)})`)
        .returning({ id: sessions.id })
    ).length;
    out.outboxPurged = (await this.db.execute(sql`delete from event_outbox where published_at is not null and created_at < ${new Date(now.getTime() - 7 * DAY)}`)).rowCount ?? 0;
    out.deliveriesPurged = (await this.db.execute(sql`delete from webhook_deliveries where created_at < ${new Date(now.getTime() - 30 * DAY)}`)).rowCount ?? 0;
    const auditDays = opts.auditRetentionDays ?? 365;
    out.auditPurged = (await this.db.execute(sql`delete from audit_log where created_at < ${new Date(now.getTime() - auditDays * DAY)}`)).rowCount ?? 0;
    out.githubEventsPurged = (await this.db.execute(sql`delete from github_events where received_at < ${new Date(now.getTime() - 30 * DAY)} and status <> 'pending'`)).rowCount ?? 0;
    out.webhooksRequeued = await this.webhookService.sweepPending();
    out.workspacePurged = (await this.purgeWorkspaceIfDue(now)) ? 1 : 0;
    this.logger.info(out, 'maintenance run');
    return out;
  }

  /** Trash = 30-day recovery then hard delete (SPEC §3.5.1). */
  async purgeTrash(now = this.now()): Promise<number> {
    const due = await this.db
      .select({ id: issues.id })
      .from(issues)
      .where(and(isNotNull(issues.trashedAt), lt(issues.trashedAt, new Date(now.getTime() - 30 * DAY))))
      .limit(1000);
    for (const { id } of due) await this.issueService.deleteForever(systemActor('system'), id);
    const files = await this.db
      .delete(attachments)
      .where(and(isNotNull(attachments.trashedAt), lt(attachments.trashedAt, new Date(now.getTime() - 30 * DAY))))
      .returning({ path: attachments.storagePath });
    for (const f of files) await this.storage.delete(f.path).catch(() => {});
    return due.length;
  }

  /**
   * Workspace deletion: after the 7-day retention window, every domain table is truncated and
   * the deployment returns to first-run state. Uploaded files are removed by directory.
   */
  async purgeWorkspaceIfDue(now = this.now()): Promise<boolean> {
    const [ws] = await this.db.select().from(workspace).where(eq(workspace.id, 1));
    if (!ws?.deletionRequestedAt || ws.deletionRequestedAt.getTime() > now.getTime() - 7 * DAY) return false;
    const paths = await this.db.select({ path: attachments.storagePath }).from(attachments);
    await this.db.execute(sql`truncate table
      reactions, comments, issue_labels, issue_relations, issue_activity, cycle_history, github_links, attachments,
      notifications, subscriptions, favorites, views, issues, milestones, project_teams, projects, cycles,
      statuses, workflows, team_counters, team_members, teams, labels, webhook_deliveries, webhooks,
      github_events, github_installs, import_items, import_runs, exports, invites, api_keys, sessions,
      mcp_sessions, event_outbox, users, workspace restart identity cascade`);
    for (const p of paths) await this.storage.delete(p.path).catch(() => {});
    this.logger.warn('workspace purged after deletion retention window');
    return true;
  }
}
