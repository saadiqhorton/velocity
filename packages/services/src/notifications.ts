import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { notifications } from '@velocity/schema';
import type { NotificationType } from '@velocity/schema';
import { publish } from '@velocity/events';
import { ServiceBase } from './base';
import type { ServiceActor } from './context';
import type { DbOrTx } from './db';

export type NotificationRow = typeof notifications.$inferSelect;

export interface NotificationDraft {
  userId: string;
  issueId: string | null;
  actorUserId: string | null;
  type: NotificationType;
  payload?: Record<string, unknown>;
}

/** In-app inbox (SPEC §3.11, §4.11.10). Fan-out happens in event-handlers.ts. */
export class NotificationService extends ServiceBase {
  async list(
    actor: ServiceActor,
    opts: { preset?: 'all' | 'assigned' | 'subscribed' | 'unread' | null; first?: number | null; before?: Date | null } = {},
  ): Promise<NotificationRow[]> {
    const conds = [eq(notifications.userId, actor.userId)];
    if (opts.preset === 'assigned') conds.push(eq(notifications.type, 'assigned'));
    if (opts.preset === 'subscribed') conds.push(sql`${notifications.type} <> 'assigned'`);
    if (opts.preset === 'unread') conds.push(isNull(notifications.readAt));
    if (opts.before) conds.push(lt(notifications.createdAt, opts.before));
    // Unread first, then newest (SPEC §3.11 "unread-first, day-grouped").
    return this.db
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(sql`${notifications.readAt} is not null`, desc(notifications.createdAt))
      .limit(Math.min(opts.first ?? 100, 500));
  }

  async unreadCount(actor: ServiceActor): Promise<number> {
    if (!actor.userId) return 0;
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)));
    return r?.n ?? 0;
  }

  async setRead(actor: ServiceActor, ids: string[], read: boolean): Promise<NotificationRow[]> {
    if (!ids.length) return [];
    return this.db
      .update(notifications)
      .set({ readAt: read ? this.now() : null })
      .where(and(inArray(notifications.id, ids), eq(notifications.userId, actor.userId)))
      .returning();
  }

  async markAllRead(actor: ServiceActor): Promise<number> {
    const res = await this.db
      .update(notifications)
      .set({ readAt: this.now() })
      .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return res.length;
  }

  async markReadForIssue(actor: ServiceActor, issueId: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: this.now() })
      .where(and(eq(notifications.userId, actor.userId), eq(notifications.issueId, issueId), isNull(notifications.readAt)));
  }

  async delete(actor: ServiceActor, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.db.delete(notifications).where(and(inArray(notifications.id, ids), eq(notifications.userId, actor.userId)));
  }

  /** Insert notifications (deduping same user+issue+type within a minute) and emit events. */
  async createMany(executor: DbOrTx, drafts: NotificationDraft[]): Promise<NotificationRow[]> {
    const out: NotificationRow[] = [];
    const seen = new Set<string>();
    for (const d of drafts) {
      const key = `${d.userId}|${d.issueId}|${d.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const recent = await executor
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, d.userId),
            d.issueId ? eq(notifications.issueId, d.issueId) : isNull(notifications.issueId),
            eq(notifications.type, d.type),
            isNull(notifications.readAt),
            sql`${notifications.createdAt} > now() - interval '1 minute'`,
          ),
        )
        .limit(1);
      if (recent.length) {
        const [row] = await executor
          .update(notifications)
          .set({ payload: d.payload ?? {}, actorUserId: d.actorUserId, createdAt: this.now() })
          .where(eq(notifications.id, recent[0]!.id))
          .returning();
        if (row) out.push(row);
        continue;
      }
      const [row] = await executor
        .insert(notifications)
        .values({ userId: d.userId, issueId: d.issueId, actorUserId: d.actorUserId, type: d.type, payload: d.payload ?? {} })
        .returning();
      if (row) {
        out.push(row);
        await publish(executor, 'notification.created', { notificationId: row.id, userId: row.userId });
      }
    }
    return out;
  }
}
