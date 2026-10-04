import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { apiKeys, issues, sessions, statuses, users } from '@velocity/schema';
import { ServiceBase } from './base';
import type { AuditService } from './audit';
import type { ServiceActor } from './context';
import { notFound, validation } from './errors';
import { hashSecret, validateEmail, validateUsername } from './auth';
import { randomToken } from './lib/crypto';
import { validatePassword } from './lib/password-policy';
import { assertCan } from './lib/permissions';

export type UserRow = typeof users.$inferSelect;

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export function assertTimezone(tz: string): void {
  if (tz !== 'UTC' && !TIMEZONES.has(tz)) throw validation(`Unknown timezone “${tz}”.`, { field: 'timezone' });
}

export class UserService extends ServiceBase {
  private audit!: AuditService;
  bind(audit: AuditService): void {
    this.audit = audit;
  }

  async list(_actor: ServiceActor, opts: { includeSuspended?: boolean } = {}): Promise<UserRow[]> {
    return this.db
      .select()
      .from(users)
      .where(and(isNull(users.deletedAt), opts.includeSuspended ? undefined : isNull(users.suspendedAt)))
      .orderBy(asc(users.name));
  }

  async get(id: string): Promise<UserRow | null> {
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    return u ?? null;
  }

  async getMany(ids: readonly string[]): Promise<UserRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(users).where(inArray(users.id, [...ids]));
  }

  async byUsername(username: string): Promise<UserRow | null> {
    const [u] = await this.db.select().from(users).where(and(eq(users.username, username.toLowerCase()), isNull(users.deletedAt)));
    return u ?? null;
  }

  async updateProfile(
    actor: ServiceActor,
    patch: { name?: string | null; email?: string | null; username?: string | null; timezone?: string | null; locale?: string | null; theme?: 'dark' | 'light' | 'system' | null },
  ): Promise<UserRow> {
    const set: Partial<typeof users.$inferInsert> = { updatedAt: this.now() };
    if (patch.name != null) {
      const n = patch.name.trim();
      if (!n || n.length > 64) throw validation('Name must be 1–64 characters.', { field: 'name' });
      set.name = n;
    }
    if (patch.email !== undefined) set.email = validateEmail(patch.email);
    if (patch.username != null) set.username = validateUsername(patch.username);
    if (patch.timezone != null) {
      assertTimezone(patch.timezone);
      set.timezone = patch.timezone;
    }
    if (patch.locale != null) set.locale = patch.locale.slice(0, 16);
    if (patch.theme != null) set.theme = patch.theme;
    try {
      const [u] = await this.db.update(users).set(set).where(eq(users.id, actor.userId)).returning();
      if (!u) throw notFound('User');
      return u;
    } catch (err) {
      const c = (err as { constraint?: string }).constraint ?? (err as { cause?: { constraint?: string } }).cause?.constraint;
      if (c === 'users_username_uq') throw validation('That username is taken.', { field: 'username' });
      if (c === 'users_email_uq') throw validation('That email is already used by another member.', { field: 'email' });
      throw err;
    }
  }

  async setAvatar(actor: ServiceActor, avatarPath: string | null): Promise<UserRow> {
    const [u] = await this.db.update(users).set({ avatarPath, updatedAt: this.now() }).where(eq(users.id, actor.userId)).returning();
    if (!u) throw notFound('User');
    return u;
  }

  /** Owner: suspend/reactivate a member. Suspension revokes sessions and API keys stop resolving. */
  async setSuspended(actor: ServiceActor, userId: string, suspended: boolean): Promise<UserRow> {
    assertCan(actor, 'member.manage');
    if (userId === actor.userId) throw validation('You can’t suspend your own account.');
    return this.tx(async (tx) => {
      const [u] = await tx
        .update(users)
        .set({ suspendedAt: suspended ? this.now() : null, updatedAt: this.now() })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning();
      if (!u) throw notFound('Member');
      if (suspended) await tx.update(sessions).set({ revokedAt: this.now() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      await this.audit.log(tx, actor, { action: suspended ? 'member.suspended' : 'member.unsuspended', objectType: 'user', objectId: userId });
      return u;
    });
  }

  /** Owner: reset a member's password (no email flow in v1.1). */
  async setPassword(actor: ServiceActor, userId: string, password: string): Promise<void> {
    assertCan(actor, 'member.manage');
    const u = await this.get(userId);
    if (!u || u.deletedAt) throw notFound('Member');
    const res = validatePassword(password, { username: u.username, email: u.email });
    if (!res.ok) throw validation(res.message, { field: 'password' });
    const passwordHash = await hashSecret(password);
    await this.tx(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: this.now() }).where(eq(users.id, userId));
      await tx.update(sessions).set({ revokedAt: this.now() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      await this.audit.log(tx, actor, { action: 'member.password_reset', objectType: 'user', objectId: userId });
    });
  }

  /**
   * Remove a member (owner) or delete your own account (SPEC §7.2): the row becomes a
   * "Former member" stub so history stays attributed; open issues are unassigned;
   * sessions and keys are revoked.
   */
  async remove(actor: ServiceActor, userId: string): Promise<void> {
    if (userId !== actor.userId) assertCan(actor, 'member.manage');
    const u = await this.get(userId);
    if (!u || u.deletedAt) throw notFound('Member');
    if (u.isOwner) throw validation('The workspace owner can’t be removed.');
    await this.tx(async (tx) => {
      const doneStatuses = tx.select({ id: statuses.id }).from(statuses).where(inArray(statuses.category, ['done', 'canceled']));
      await tx
        .update(issues)
        .set({ assigneeId: null, updatedAt: this.now() })
        .where(and(eq(issues.assigneeId, userId), notInArray(issues.statusId, doneStatuses)));
      await tx
        .update(users)
        .set({
          name: 'Former member',
          username: `former-${userId.slice(-12)}`,
          email: null,
          avatarPath: null,
          passwordHash: await hashSecret(randomToken(24)),
          deletedAt: this.now(),
          updatedAt: this.now(),
        })
        .where(eq(users.id, userId));
      await tx.update(sessions).set({ revokedAt: this.now() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      await tx.update(apiKeys).set({ revokedAt: this.now() }).where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
      await this.audit.log(tx, actor, { action: 'member.removed', objectType: 'user', objectId: userId });
    });
  }

  async count(): Promise<number> {
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users).where(isNull(users.deletedAt));
    return r?.n ?? 0;
  }
}
