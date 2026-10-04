import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { apiKeys, invites, mcpSessions, sessions, users, workspace } from '@velocity/schema';
import { ServiceBase } from './base';
import type { ServiceActor } from './context';
import type { AuditService } from './audit';
import { ServiceError, conflict, notFound, unauthenticated, validation } from './errors';
import { randomToken, sha256Hex } from './lib/crypto';
import { slugify } from './lib/identifiers';
import { validatePassword } from './lib/password-policy';
import { assertCan } from './lib/permissions';

/** OWASP-recommended argon2id parameters (19 MiB, t=2, p=1). */
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashSecret = (plain: string): Promise<string> => argonHash(plain, ARGON_OPTS);
export const verifySecret = async (hash: string, plain: string): Promise<boolean> => {
  try {
    return await argonVerify(hash, plain);
  } catch {
    return false;
  }
};

const DAY = 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;

export interface IssuedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  user: UserRow;
}

export interface ClientInfo {
  ip?: string | null;
  userAgent?: string | null;
}

/** In-process progressive delay for failed logins (SPEC §7.1.2: per IP + account). */
class LoginThrottle {
  private failures = new Map<string, { count: number; until: number; last: number }>();

  check(key: string, now: number): number {
    const f = this.failures.get(key);
    if (!f) return 0;
    if (now - f.last > 15 * 60 * 1000) {
      this.failures.delete(key);
      return 0;
    }
    return Math.max(0, f.until - now);
  }

  fail(key: string, now: number): void {
    const f = this.failures.get(key) ?? { count: 0, until: 0, last: now };
    f.count += 1;
    f.last = now;
    // First 3 failures are free; then 2s, 4s, 8s … capped at 60s.
    const delay = f.count <= 3 ? 0 : Math.min(60_000, 1000 * 2 ** (f.count - 3));
    f.until = now + delay;
    this.failures.set(key, f);
    if (this.failures.size > 10_000) {
      for (const [k, v] of this.failures) if (now - v.last > 15 * 60 * 1000) this.failures.delete(k);
    }
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }
}

export function validateUsername(username: string): string {
  const u = username.trim().toLowerCase();
  if (!USERNAME_RE.test(u)) {
    throw validation('Usernames are 2–32 characters: letters, numbers, dots, dashes or underscores.', {
      field: 'username',
    });
  }
  return u;
}

export function validateEmail(email: string | null | undefined): string | null {
  const e = email?.trim();
  if (!e) return null;
  if (!EMAIL_RE.test(e) || e.length > 254) throw validation('Enter a valid email address.', { field: 'email' });
  return e.toLowerCase();
}

function assertPassword(password: string, ctx: { username?: string; email?: string | null }): void {
  const res = validatePassword(password, ctx);
  if (!res.ok) throw validation(res.message, { field: 'password', reason: res.reason });
}

export class AuthService extends ServiceBase {
  private readonly throttle = new LoginThrottle();
  /** sha256(key) → verified key id, so argon2 runs once per key per TTL (SPEC §6.2). */
  private readonly keyCache = new Map<string, { apiKeyId: string; expires: number }>();
  /**
   * tokenHash → resolved session. Session resolution runs on every request
   * (SPEC §7.1.2), so a short-lived cache keeps the hot list path off the DB
   * (SPEC §4.16). Every path that revokes sessions invalidates explicitly, so
   * cached entries can never outlive their revocation.
   */
  private readonly sessionCache = new Map<string, { user: UserRow; session: SessionRow; expires: number }>();
  private audit!: AuditService;

  bind(audit: AuditService): void {
    this.audit = audit;
  }

  // ───────────── First-run setup ─────────────

  async setupStatus(): Promise<{ needsSetup: boolean; workspaceName: string | null; setupCompleted: boolean; signupEnabled: boolean }> {
    const [ws] = await this.db.select().from(workspace).limit(1);
    const [{ n } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users);
    return {
      needsSetup: n === 0,
      workspaceName: ws?.name ?? null,
      setupCompleted: Boolean(ws?.setupCompletedAt),
      signupEnabled: n > 0 && !this.config.disableSignup,
    };
  }

  /**
   * Install-time owner wizard (SPEC §3.2.1, §3.3): creates the workspace row and the owner.
   * Only possible while no user exists; the workspace singleton PK guards against races.
   */
  async setupWorkspace(
    input: { workspaceName: string; username: string; password: string; name?: string | null; email?: string | null },
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const workspaceName = input.workspaceName.trim();
    if (!workspaceName || workspaceName.length > 64) throw validation('Workspace name must be 1–64 characters.', { field: 'workspaceName' });
    const username = validateUsername(input.username);
    const email = validateEmail(input.email);
    assertPassword(input.password, { username, email });
    const passwordHash = await hashSecret(input.password);

    const user = await this.tx(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(4206942018)`);
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
      if (n > 0) throw conflict('This workspace is already set up. Sign in instead.');
      await tx
        .insert(workspace)
        .values({ id: 1, name: workspaceName, slug: slugify(workspaceName) || 'workspace' })
        .onConflictDoUpdate({ target: workspace.id, set: { name: workspaceName, slug: slugify(workspaceName) || 'workspace' } });
      const [u] = await tx
        .insert(users)
        .values({ username, email, passwordHash, name: input.name?.trim() || username, isOwner: true })
        .returning();
      if (!u) throw new Error('owner insert failed');
      await this.audit.log(tx, { ...ownerActor(u.id), ip: client.ip ?? null }, { action: 'workspace.setup', objectType: 'workspace', objectId: '1' });
      return u;
    });
    return this.issueSession(user, false, client);
  }

  async completeSetup(actor: ServiceActor): Promise<void> {
    assertCan(actor, 'workspace.settings');
    await this.db.update(workspace).set({ setupCompletedAt: this.now(), updatedAt: this.now() }).where(eq(workspace.id, 1));
  }

  // ───────────── Sessions ─────────────

  async login(input: { login: string; password: string; remember?: boolean }, client: ClientInfo): Promise<IssuedSession> {
    const login = input.login.trim().toLowerCase();
    const key = `${client.ip ?? '-'}|${login}`;
    const now = Date.now();
    const wait = this.throttle.check(key, now);
    if (wait > 0) {
      throw new ServiceError('RATE_LIMITED', `Too many sign-in attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`, {
        retryAfter: Math.ceil(wait / 1000),
      });
    }
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(or(eq(users.username, login), eq(users.email, login)), isNull(users.deletedAt)))
      .limit(1);
    // Always run a hash verification to keep timing uniform for unknown accounts.
    const ok = user ? await verifySecret(user.passwordHash, input.password) : await verifySecret(await dummyHash(), input.password);
    if (!user || !ok) {
      this.throttle.fail(key, now);
      await this.audit.log(this.db, null, { action: 'auth.login_failed', objectType: 'user', changes: { login }, objectId: user?.id ?? null });
      throw unauthenticated('That username or password is incorrect.');
    }
    if (user.suspendedAt) throw new ServiceError('FORBIDDEN', 'This account is suspended. Ask the workspace owner to reactivate it.');
    this.throttle.succeed(key);
    const issued = await this.issueSession(user, Boolean(input.remember), client);
    await this.audit.log(this.db, { ...memberActor(user), ip: client.ip ?? null }, { action: 'auth.login', objectType: 'user', objectId: user.id });
    return issued;
  }

  private async issueSession(user: UserRow, remember: boolean, client: ClientInfo): Promise<IssuedSession> {
    const token = randomToken(16);
    const csrfToken = randomToken(16);
    const expiresAt = new Date(this.now().getTime() + (remember ? 30 : 7) * DAY);
    await this.db.insert(sessions).values({
      userId: user.id,
      tokenHash: sha256Hex(token),
      csrfToken,
      expiresAt,
      ip: client.ip ?? null,
      userAgent: client.userAgent?.slice(0, 512) ?? null,
    });
    return { token, csrfToken, expiresAt, user };
  }

  async resolveSession(token: string): Promise<{ user: UserRow; session: SessionRow } | null> {
    if (!token || token.length > 128) return null;
    const cacheKey = sha256Hex(token);
    const cached = this.sessionCache.get(cacheKey);
    if (cached) {
      if (cached.expires > Date.now()) return { user: cached.user, session: cached.session };
      this.sessionCache.delete(cacheKey);
    }
    const rows = await this.db
      .select({ s: sessions, u: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, cacheKey), isNull(sessions.revokedAt), gt(sessions.expiresAt, this.now())))
      .limit(1);
    const row = rows[0];
    if (!row || row.u.suspendedAt || row.u.deletedAt) return null;
    const last = row.s.lastUsedAt?.getTime() ?? 0;
    if (this.now().getTime() - last > 60_000) {
      await this.db.update(sessions).set({ lastUsedAt: this.now() }).where(eq(sessions.id, row.s.id));
    }
    this.sessionCache.set(cacheKey, { user: row.u, session: row.s, expires: Date.now() + 10_000 });
    if (this.sessionCache.size > 5000) this.sessionCache.clear();
    return { user: row.u, session: row.s };
  }

  /** Drop one cached session (logout) or every session of a user (revoke/suspend/remove). */
  forgetSession(token: string): void {
    this.sessionCache.delete(sha256Hex(token));
  }

  forgetSessionsForUser(userId: string): void {
    for (const [key, entry] of this.sessionCache) {
      if (entry.user.id === userId) this.sessionCache.delete(key);
    }
  }

  async logout(token: string, actor: ServiceActor | null): Promise<void> {
    this.forgetSession(token);
    await this.db.update(sessions).set({ revokedAt: this.now() }).where(eq(sessions.tokenHash, sha256Hex(token)));
    if (actor) await this.audit.log(this.db, actor, { action: 'auth.logout', objectType: 'user', objectId: actor.userId });
  }

  async listSessions(actor: ServiceActor) {
    return this.db
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
        expiresAt: sessions.expiresAt,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, actor.userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, this.now())))
      .orderBy(desc(sessions.createdAt));
  }

  /** "Revoke all" (SPEC §7.1.2). Keeps the current session when its id is given. */
  async revokeAllSessions(actor: ServiceActor, exceptSessionId?: string | null): Promise<number> {
    const res = await this.db
      .update(sessions)
      .set({ revokedAt: this.now() })
      .where(
        and(
          eq(sessions.userId, actor.userId),
          isNull(sessions.revokedAt),
          exceptSessionId ? sql`${sessions.id} <> ${exceptSessionId}` : undefined,
        ),
      )
      .returning({ id: sessions.id });
    await this.audit.log(this.db, actor, { action: 'auth.sessions_revoked', objectType: 'user', objectId: actor.userId, changes: { count: res.length } });
    return res.length;
  }

  async revokeSession(actor: ServiceActor, sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: this.now() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, actor.userId)));
    for (const [key, entry] of this.sessionCache) {
      if (entry.session.id === sessionId) this.sessionCache.delete(key);
    }
  }

  async changePassword(actor: ServiceActor, input: { currentPassword: string; newPassword: string }, currentSessionId?: string | null): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, actor.userId));
    if (!user) throw notFound('User');
    if (!(await verifySecret(user.passwordHash, input.currentPassword))) {
      throw validation('Your current password is incorrect.', { field: 'currentPassword' });
    }
    assertPassword(input.newPassword, { username: user.username, email: user.email });
    const passwordHash = await hashSecret(input.newPassword);
    await this.tx(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: this.now() }).where(eq(users.id, user.id));
      // Rotate: every other session is revoked on a credential change (SPEC §7.1.2).
      await tx
        .update(sessions)
        .set({ revokedAt: this.now() })
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), currentSessionId ? sql`${sessions.id} <> ${currentSessionId}` : undefined));
      await this.audit.log(tx, actor, { action: 'auth.password_changed', objectType: 'user', objectId: user.id });
    });
    this.forgetSessionsForUser(user.id);
  }

  // ───────────── API keys (resolution; CRUD lives in ApiKeyService) ─────────────

  async resolveApiKey(key: string): Promise<{ user: UserRow; apiKey: ApiKeyRow } | null> {
    if (!key.startsWith('vel_') || key.length < 20 || key.length > 100) return null;
    const prefix = key.slice(0, 12);
    const cacheKey = sha256Hex(key);
    const cached = this.keyCache.get(cacheKey);
    const rows = await this.db
      .select({ k: apiKeys, u: users })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .where(and(eq(apiKeys.prefix, prefix), isNull(apiKeys.revokedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.k.expiresAt && row.k.expiresAt <= this.now()) return null;
    if (row.u.suspendedAt || row.u.deletedAt) return null;
    if (!(cached && cached.apiKeyId === row.k.id && cached.expires > Date.now())) {
      if (!(await verifySecret(row.k.keyHash, key))) return null;
      this.keyCache.set(cacheKey, { apiKeyId: row.k.id, expires: Date.now() + 60_000 });
      if (this.keyCache.size > 5000) this.keyCache.clear();
    }
    const last = row.k.lastUsedAt?.getTime() ?? 0;
    if (this.now().getTime() - last > 60_000) {
      await this.db.update(apiKeys).set({ lastUsedAt: this.now() }).where(eq(apiKeys.id, row.k.id));
    }
    return { user: row.u, apiKey: row.k };
  }

  forgetApiKey(): void {
    this.keyCache.clear();
  }

  // ───────────── Invites (shared-secret links, no email — SPEC §3.2.1) ─────────────

  async createInvite(actor: ServiceActor, input: { name?: string | null; expiresInDays?: number | null }): Promise<{ id: string; url: string; token: string; expiresAt: Date }> {
    assertCan(actor, 'member.invite');
    const token = randomToken(24);
    const days = Math.min(Math.max(input.expiresInDays ?? 7, 1), 90);
    const expiresAt = new Date(this.now().getTime() + days * DAY);
    const [row] = await this.db
      .insert(invites)
      .values({ tokenHash: sha256Hex(token), name: input.name?.trim() || null, createdBy: actor.userId, expiresAt })
      .returning();
    if (!row) throw new Error('invite insert failed');
    await this.audit.log(this.db, actor, { action: 'member.invited', objectType: 'invite', objectId: row.id, changes: { name: row.name } });
    return { id: row.id, token, url: `${this.config.appUrl.replace(/\/$/, '')}/invite/${token}`, expiresAt };
  }

  async listInvites(actor: ServiceActor) {
    assertCan(actor, 'member.invite');
    return this.db
      .select({ id: invites.id, name: invites.name, createdAt: invites.createdAt, expiresAt: invites.expiresAt, usedAt: invites.usedAt })
      .from(invites)
      .where(and(isNull(invites.revokedAt), isNull(invites.usedAt), gt(invites.expiresAt, this.now())))
      .orderBy(desc(invites.createdAt));
  }

  async revokeInvite(actor: ServiceActor, id: string): Promise<void> {
    assertCan(actor, 'member.invite');
    await this.db.update(invites).set({ revokedAt: this.now() }).where(eq(invites.id, id));
    await this.audit.log(this.db, actor, { action: 'member.invite_revoked', objectType: 'invite', objectId: id });
  }

  async inviteInfo(token: string): Promise<{ valid: boolean; name: string | null; workspaceName: string | null }> {
    const [ws] = await this.db.select({ name: workspace.name }).from(workspace).limit(1);
    const inv = await this.findInvite(token);
    return { valid: Boolean(inv), name: inv?.name ?? null, workspaceName: ws?.name ?? null };
  }

  private async findInvite(token: string) {
    if (!token) return null;
    const [inv] = await this.db
      .select()
      .from(invites)
      .where(and(eq(invites.tokenHash, sha256Hex(token)), isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, this.now())))
      .limit(1);
    return inv ?? null;
  }

  async acceptInvite(
    input: { token: string; username: string; password: string; name?: string | null; email?: string | null },
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const username = validateUsername(input.username);
    const email = validateEmail(input.email);
    assertPassword(input.password, { username, email });
    const passwordHash = await hashSecret(input.password);
    const user = await this.tx(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invites)
        .where(and(eq(invites.tokenHash, sha256Hex(input.token)), isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, this.now())))
        .for('update')
        .limit(1);
      if (!inv) throw validation('This invite link is invalid or has expired. Ask the workspace owner for a new one.');
      const u = await this.insertUser(tx, { username, email, passwordHash, name: input.name?.trim() || inv.name || username });
      await tx.update(invites).set({ usedAt: this.now(), usedByUserId: u.id }).where(eq(invites.id, inv.id));
      await this.audit.log(tx, { ...memberActor(u), ip: client.ip ?? null }, { action: 'member.joined', objectType: 'user', objectId: u.id, changes: { inviteId: inv.id } });
      return u;
    });
    return this.issueSession(user, false, client);
  }

  /** Open signup — only when DISABLE_SIGNUP=false (SPEC §5.10). */
  async signup(input: { username: string; password: string; name?: string | null; email?: string | null }, client: ClientInfo): Promise<IssuedSession> {
    const status = await this.setupStatus();
    if (status.needsSetup) throw validation('Finish setting up the workspace first.');
    if (!status.signupEnabled) throw new ServiceError('FORBIDDEN', 'Sign-up is disabled. Ask the workspace owner for an invite link.');
    const username = validateUsername(input.username);
    const email = validateEmail(input.email);
    assertPassword(input.password, { username, email });
    const passwordHash = await hashSecret(input.password);
    const user = await this.tx(async (tx) => {
      const u = await this.insertUser(tx, { username, email, passwordHash, name: input.name?.trim() || username });
      await this.audit.log(tx, { ...memberActor(u), ip: client.ip ?? null }, { action: 'member.joined', objectType: 'user', objectId: u.id });
      return u;
    });
    return this.issueSession(user, false, client);
  }

  private async insertUser(
    tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0],
    v: { username: string; email: string | null; passwordHash: string; name: string },
  ): Promise<UserRow> {
    try {
      const [u] = await tx.insert(users).values(v).returning();
      if (!u) throw new Error('user insert failed');
      return u;
    } catch (err) {
      const c = (err as { constraint?: string; cause?: { constraint?: string } }).constraint ?? (err as { cause?: { constraint?: string } }).cause?.constraint;
      if (c === 'users_username_uq') throw conflict('That username is taken.', { field: 'username' });
      if (c === 'users_email_uq') throw conflict('That email is already used by another member.', { field: 'email' });
      throw err;
    }
  }

  // ───────────── MCP sessions (SPEC §5.12 "MCP session start" is audited) ─────────────

  async startMcpSession(actor: ServiceActor, input: { clientName?: string | null; transport: 'stdio' | 'http' }): Promise<string> {
    if (!actor.userId) throw unauthenticated();
    const [row] = await this.db
      .insert(mcpSessions)
      .values({ userId: actor.userId, apiKeyId: actor.apiKeyId ?? null, clientName: input.clientName?.slice(0, 128) ?? null, transport: input.transport })
      .returning();
    if (!row) throw new Error('mcp session insert failed');
    await this.audit.log(this.db, { ...actor, mcpSessionId: row.id }, { action: 'mcp.session_started', objectType: 'mcp_session', objectId: row.id, changes: { clientName: row.clientName, transport: row.transport } });
    return row.id;
  }

  async touchMcpSession(id: string, userId: string): Promise<boolean> {
    const res = await this.db
      .update(mcpSessions)
      .set({ lastSeenAt: this.now() })
      .where(and(eq(mcpSessions.id, id), eq(mcpSessions.userId, userId)))
      .returning({ id: mcpSessions.id });
    return res.length > 0;
  }
}

// A real argon2id hash of a random secret (same params) — verifying against it for unknown
// logins keeps response timing uniform, so usernames can't be probed by latency.
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashSecret(randomToken(16));
  return dummyHashPromise;
}

export function memberActor(u: Pick<UserRow, 'id' | 'isOwner' | 'suspendedAt'>): ServiceActor {
  return { userId: u.id, isOwner: u.isOwner, suspended: Boolean(u.suspendedAt), via: 'session', scope: 'write', kind: 'user' };
}

function ownerActor(userId: string): ServiceActor {
  return { userId, isOwner: true, suspended: false, via: 'session', scope: 'write', kind: 'user' };
}
