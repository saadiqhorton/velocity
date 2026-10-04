import { and, desc, eq, isNull } from 'drizzle-orm';
import { apiKeys, users } from '@velocity/schema';
import type { ApiKeyScope } from '@velocity/schema';
import { ServiceBase } from './base';
import type { AuditService } from './audit';
import type { AuthService } from './auth';
import { hashSecret } from './auth';
import type { ServiceActor } from './context';
import { notFound, validation } from './errors';
import { generateApiKey } from './lib/crypto';
import { assertCan, can } from './lib/permissions';

/** Personal API keys (SPEC §3.2.2, §6.2): `vel_`-prefixed, shown once, argon2id-hashed. */
export class ApiKeyService extends ServiceBase {
  private audit!: AuditService;
  private auth!: AuthService;
  bind(audit: AuditService, auth: AuthService): void {
    this.audit = audit;
    this.auth = auth;
  }

  async create(actor: ServiceActor, input: { name: string; scope: ApiKeyScope; expiresInDays?: number | null }) {
    assertCan(actor, 'apikey.manage_own');
    if (actor.via !== 'session') throw validation('API keys can only be created from a signed-in session.');
    const name = input.name.trim();
    if (!name || name.length > 64) throw validation('Key name must be 1–64 characters.', { field: 'name' });
    const { key, prefix } = generateApiKey();
    const expiresAt = input.expiresInDays ? new Date(this.now().getTime() + input.expiresInDays * 86_400_000) : null;
    const [row] = await this.db
      .insert(apiKeys)
      .values({ userId: actor.userId, name, prefix, keyHash: await hashSecret(key), scope: input.scope, expiresAt })
      .returning();
    if (!row) throw new Error('api key insert failed');
    await this.audit.log(this.db, actor, { action: 'apikey.created', objectType: 'api_key', objectId: row.id, changes: { name, scope: input.scope, prefix } });
    return { apiKey: row, plaintext: key };
  }

  /** Own keys; owners see everyone's (SPEC §3.12). */
  async list(actor: ServiceActor, opts: { all?: boolean } = {}) {
    const all = opts.all && can(actor, 'apikey.view_all');
    return this.db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        userName: users.name,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scope: apiKeys.scope,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .where(and(isNull(apiKeys.revokedAt), all ? undefined : eq(apiKeys.userId, actor.userId)))
      .orderBy(desc(apiKeys.createdAt));
  }

  async revoke(actor: ServiceActor, id: string): Promise<void> {
    const [key] = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id));
    if (!key || key.revokedAt) throw notFound('API key');
    if (key.userId !== actor.userId) assertCan(actor, 'apikey.revoke_any');
    else assertCan(actor, 'apikey.manage_own');
    await this.db.update(apiKeys).set({ revokedAt: this.now() }).where(eq(apiKeys.id, id));
    this.auth.forgetApiKey();
    await this.audit.log(this.db, actor, { action: 'apikey.revoked', objectType: 'api_key', objectId: id, changes: { name: key.name, prefix: key.prefix } });
  }

  async activity(actor: ServiceActor, id: string) {
    const [key] = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id));
    if (!key) throw notFound('API key');
    if (key.userId !== actor.userId) assertCan(actor, 'apikey.view_all');
    return this.audit.keyActivity(actor, id, 24);
  }
}
