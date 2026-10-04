import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { apiKeys, issues, sessions, statuses, users } from '@velocity/schema';
import { ServiceBase } from './base';
import type { AuditService } from './audit';
import type { ServiceActor } from './context';
import { notFound, validation } from './errors';
import { hashSecret, validateEmail, validateUsername } from './auth';
import type { AuthService } from './auth';
import { randomToken } from './lib/crypto';
import { validatePassword } from './lib/password-policy';
import { assertCan } from './lib/permissions';
import { clamScan } from './attachments';

export type UserRow = typeof users.$inferSelect;

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export function assertTimezone(tz: string): void {
  if (tz !== 'UTC' && !TIMEZONES.has(tz)) throw validation(`Unknown timezone “${tz}”.`, { field: 'timezone' });
}

export class UserService extends ServiceBase {
  private audit!: AuditService;
  private auth: AuthService | null = null;
  bind(audit: AuditService, auth?: AuthService): void {
    this.audit = audit;
    if (auth) this.auth = auth;
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
    // Own-profile writes need an authenticated writer; read-scoped keys stay read-only (SPEC §3.2.3).
    assertCan(actor, 'issue.write');
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
    assertCan(actor, 'issue.write');
    const [u] = await this.db.update(users).set({ avatarPath, updatedAt: this.now() }).where(eq(users.id, actor.userId)).returning();
    if (!u) throw notFound('User');
    return u;
  }

  /** Clear the profile image and delete the stored file (SPEC §3.12 profile). */
  async removeAvatar(actor: ServiceActor): Promise<UserRow> {
    const current = await this.get(actor.userId);
    if (!current || current.deletedAt) throw notFound('User');
    const prev = current.avatarPath;
    const updated = await this.setAvatar(actor, null);
    if (prev) await this.storage.delete(prev).catch(() => {});
    return updated;
  }

  /** Profile images are decoded, bounded and re-encoded; client MIME is never trusted. */
  async uploadAvatar(actor: ServiceActor, data: Buffer): Promise<UserRow> {
    assertCan(actor, 'issue.write');
    if (!data.length || data.length > this.config.maxUploadMb * 1024 * 1024) {
      throw validation(`Choose a non-empty image smaller than ${this.config.maxUploadMb} MB.`);
    }
    const current = await this.get(actor.userId);
    if (!current || current.deletedAt) throw notFound('User');
    let image: Buffer;
    try {
      const decoder = sharp(data, { failOn: 'error', limitInputPixels: 25_000_000 });
      const metadata = await decoder.metadata();
      if (!['png', 'jpeg', 'webp', 'gif'].includes(metadata.format ?? '')) throw new Error('Unsupported format');
      image = await decoder.rotate().resize(256, 256, { fit: 'cover', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    } catch {
      throw validation('Choose a valid PNG, JPEG, GIF or WebP image, up to 25 megapixels.');
    }
    if (this.config.clamav && !(await clamScan(this.config.clamav.host, this.config.clamav.port, image)).endsWith('OK')) {
      throw validation('The virus scanner rejected this image. Choose another image.');
    }
    const path = `avatars/${actor.userId}/${randomUUID()}.webp`;
    await this.storage.put(path, image);
    let updated: UserRow;
    try {
      updated = await this.setAvatar(actor, path);
    } catch (err) {
      await this.storage.delete(path).catch(() => {});
      throw err;
    }
    if (current.avatarPath) await this.storage.delete(current.avatarPath).catch(() => {});
    return updated;
  }

  /** Owner: suspend/reactivate a member. Suspension revokes sessions and API keys stop resolving. */
  async setSuspended(actor: ServiceActor, userId: string, suspended: boolean): Promise<UserRow> {
    assertCan(actor, 'member.manage');
    if (userId === actor.userId) throw validation('You can’t suspend your own account.');
    const u = await this.tx(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ suspendedAt: suspended ? this.now() : null, updatedAt: this.now() })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning();
      if (!row) throw notFound('Member');
      if (suspended) await tx.update(sessions).set({ revokedAt: this.now() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      await this.audit.log(tx, actor, { action: suspended ? 'member.suspended' : 'member.unsuspended', objectType: 'user', objectId: userId });
      return row;
    });
    if (suspended) this.auth?.forgetSessionsForUser(userId);
    return u;
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
    this.auth?.forgetSessionsForUser(userId);
  }

  /**
   * Remove a member (owner) or delete your own account (SPEC §7.2): the row becomes a
   * "Former member" stub so history stays attributed; open issues are unassigned;
   * sessions and keys are revoked.
   */
  async remove(actor: ServiceActor, userId: string): Promise<void> {
    // Self-removal still needs an authenticated writer; read-scoped keys stay read-only (SPEC §3.2.3).
    assertCan(actor, 'issue.write');
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
    this.auth?.forgetSessionsForUser(userId);
  }

  async count(): Promise<number> {
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users).where(isNull(users.deletedAt));
    return r?.n ?? 0;
  }
}
