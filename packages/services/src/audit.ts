import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { auditLog } from '@velocity/schema';
import { ServiceBase } from './base';
import type { ServiceActor } from './context';
import { actorUserId } from './context';
import type { DbOrTx } from './db';
import { assertCan } from './lib/permissions';

/**
 * Security-relevant audit trail (SPEC §5.12): login, member changes, integration/webhook/
 * API-key config, import/export, manual cycle close, deletes, MCP session start.
 * Never stores issue bodies — titles only.
 */
export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.sessions_revoked'
  | 'auth.password_changed'
  | 'workspace.setup'
  | 'workspace.updated'
  | 'workspace.deletion_requested'
  | 'workspace.deletion_canceled'
  | 'workspace.exported'
  | 'member.invited'
  | 'member.invite_revoked'
  | 'member.joined'
  | 'member.suspended'
  | 'member.unsuspended'
  | 'member.removed'
  | 'member.password_reset'
  | 'apikey.created'
  | 'apikey.revoked'
  | 'webhook.created'
  | 'webhook.updated'
  | 'webhook.deleted'
  | 'github.installed'
  | 'github.settings_updated'
  | 'github.uninstalled'
  | 'import.started'
  | 'import.committed'
  | 'cycle.closed_manually'
  | 'issue.deleted'
  | 'team.deleted'
  | 'project.deleted'
  | 'mcp.session_started'
  | 'mutation';

export interface AuditEntryInput {
  action: AuditAction;
  objectType?: string | null;
  objectId?: string | null;
  changes?: Record<string, unknown> | null;
}

export class AuditService extends ServiceBase {
  async log(executor: DbOrTx, actor: ServiceActor | null, entry: AuditEntryInput): Promise<void> {
    await executor.insert(auditLog).values({
      actorUserId: actor ? actorUserId(actor) : null,
      actorApiKeyId: actor?.apiKeyId ?? null,
      actorMcpSessionId: actor?.mcpSessionId ?? null,
      action: entry.action,
      objectType: entry.objectType ?? null,
      objectId: entry.objectId ?? null,
      changes: entry.changes ?? null,
      ip: actor?.ip ?? null,
    });
  }

  /**
   * Agent-facing hardening (SPEC §7.1.6): every API-key/MCP mutation is attributed.
   * Session mutations from the web app are not audited (they're not security-relevant).
   */
  async logMutation(executor: DbOrTx, actor: ServiceActor, operation: string): Promise<void> {
    if (actor.via === 'session') return;
    await this.log(executor, actor, { action: 'mutation', objectType: 'graphql', objectId: operation });
  }

  async list(
    actor: ServiceActor,
    args: { action?: string | null; actorUserId?: string | null; before?: Date | null; after?: Date | null; limit?: number; offset?: number },
  ) {
    assertCan(actor, 'audit.view');
    const conds: SQL[] = [];
    if (args.action) conds.push(eq(auditLog.action, args.action));
    if (args.actorUserId) conds.push(eq(auditLog.actorUserId, args.actorUserId));
    if (args.before) conds.push(lt(auditLog.createdAt, args.before));
    if (args.after) conds.push(gte(auditLog.createdAt, args.after));
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const where = conds.length ? and(...conds) : undefined;
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.id))
        .limit(limit)
        .offset(args.offset ?? 0),
      this.db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(where),
    ]);
    return { entries: rows, totalCount: total[0]?.n ?? 0 };
  }

  /** Per-key mutations-per-hour histogram (SPEC §7.1.6) for runaway-agent detection. */
  async keyActivity(actor: ServiceActor, apiKeyId: string, hours = 24) {
    if (!actor.isOwner) {
      // Members may inspect their own keys only — checked by the caller (ApiKeyService).
    }
    const res = await this.pool.query<{ hour: Date; count: number }>(
      `select date_trunc('hour', created_at) as hour, count(*)::int as count
       from audit_log where actor_api_key_id = $1 and action = 'mutation'
         and created_at > now() - make_interval(hours => $2)
       group by 1 order by 1`,
      [apiKeyId, hours],
    );
    return res.rows;
  }
}
