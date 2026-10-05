import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { webhookDeliveries, webhooks } from '@velocity/schema';
import type { WebhookEventType } from '@velocity/schema';
import { WEBHOOK_EVENT_TYPES } from '@velocity/schema';
import { ServiceBase } from './base';
import type { AuditService } from './audit';
import type { ServiceActor } from './context';
import type { DbOrTx } from './db';
import { notFound, validation } from './errors';
import { createCipherBox, hmacSha256Hex, randomToken } from './lib/crypto';
import type { CipherBox } from './lib/crypto';
import { assertPublicUrl, resolvePublicUrl, SsrfError } from './lib/ssrf';
import { assertCan } from './lib/permissions';

export type WebhookRow = typeof webhooks.$inferSelect;
export type DeliveryRow = typeof webhookDeliveries.$inferSelect;

const MAX_PAYLOAD = 256 * 1024;
const TIMEOUT_MS = 10_000;
/** Retry schedule (seconds) after attempts 1..5: exponential, capped at one hour (SPEC §6.4). */
const BACKOFF = [60, 300, 900, 1800, 3600];
export const MAX_ATTEMPTS = BACKOFF.length + 1;

/** Connect to the address checked by the SSRF guard while retaining the URL host for Host/SNI. */
export function postPinnedWebhook(url: string, address: string, headers: Record<string, string>, body: string): Promise<number> {
  const transport = new URL(url).protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = transport(url, {
      method: 'POST', headers, signal: AbortSignal.timeout(TIMEOUT_MS),
      lookup(_host, options, callback) {
        const family = isIP(address);
        if (options.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      res.destroy(); // Response content is never used and must not consume unbounded memory.
      resolve(status);
    });
    req.on('error', reject);
    req.end(body);
  });
}

export interface WebhookPayload {
  id: string;
  event: WebhookEventType;
  createdAt: string;
  data: Record<string, unknown>;
}

/** Outbound HMAC-signed webhooks (SPEC §6.4). Owner-registered. */
export class WebhookService extends ServiceBase {
  private audit!: AuditService;
  private cipher!: CipherBox;
  /** Overridable for tests. */
  fetchImpl: typeof fetch = fetch;

  bind(audit: AuditService): void {
    this.audit = audit;
    this.cipher = createCipherBox(this.config.appSecret);
  }

  async list(actor: ServiceActor): Promise<WebhookRow[]> {
    assertCan(actor, 'workspace.webhooks');
    return this.db.select().from(webhooks).orderBy(desc(webhooks.createdAt));
  }

  async get(actor: ServiceActor, id: string): Promise<WebhookRow> {
    assertCan(actor, 'workspace.webhooks');
    const [w] = await this.db.select().from(webhooks).where(eq(webhooks.id, id));
    if (!w) throw notFound('Webhook');
    return w;
  }

  private async validateTarget(url: string, eventTypes: string[]): Promise<void> {
    if (!eventTypes.length) throw validation('Pick at least one event.', { field: 'eventTypes' });
    for (const t of eventTypes) {
      if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(t)) throw validation(`Unknown event “${t}”.`, { field: 'eventTypes' });
    }
    try {
      await assertPublicUrl(url, { allowPrivate: this.config.allowPrivateWebhookTargets });
    } catch (err) {
      if (err instanceof SsrfError) {
        throw validation(
          err.code === 'PRIVATE_ADDRESS'
            ? 'That URL points to a private network address. Set ALLOW_PRIVATE_WEBHOOK_TARGETS=1 to allow it.'
            : 'Enter a valid http(s) URL without credentials.',
          { field: 'url', reason: err.code },
        );
      }
      throw err;
    }
  }

  /** Returns the signing secret once (it's also revealable later by the owner). */
  async create(actor: ServiceActor, input: { url: string; eventTypes: string[]; description?: string | null; enabled?: boolean | null }): Promise<{ webhook: WebhookRow; secret: string }> {
    assertCan(actor, 'workspace.webhooks');
    const url = input.url.trim();
    await this.validateTarget(url, input.eventTypes);
    const secret = `whsec_${randomToken(24)}`;
    const [row] = await this.db
      .insert(webhooks)
      .values({ url, eventTypes: input.eventTypes, description: input.description ?? null, enabled: input.enabled ?? true, secretEncrypted: this.cipher.encrypt(secret), createdBy: actor.userId })
      .returning();
    if (!row) throw new Error('webhook insert failed');
    await this.audit.log(this.db, actor, { action: 'webhook.created', objectType: 'webhook', objectId: row.id, changes: { url, eventTypes: input.eventTypes } });
    return { webhook: row, secret };
  }

  async update(actor: ServiceActor, id: string, patch: { url?: string | null; eventTypes?: string[] | null; description?: string | null; enabled?: boolean | null }): Promise<WebhookRow> {
    const current = await this.get(actor, id);
    const url = patch.url?.trim() ?? current.url;
    const eventTypes = patch.eventTypes ?? current.eventTypes;
    if (patch.url || patch.eventTypes) await this.validateTarget(url, eventTypes);
    const [row] = await this.db
      .update(webhooks)
      .set({ url, eventTypes, description: patch.description !== undefined ? patch.description : current.description, enabled: patch.enabled ?? current.enabled, updatedAt: this.now() })
      .where(eq(webhooks.id, id))
      .returning();
    await this.audit.log(this.db, actor, { action: 'webhook.updated', objectType: 'webhook', objectId: id, changes: { ...patch } });
    return row!;
  }

  async revealSecret(actor: ServiceActor, id: string): Promise<string> {
    const w = await this.get(actor, id);
    return this.cipher.decrypt(w.secretEncrypted);
  }

  async rotateSecret(actor: ServiceActor, id: string): Promise<string> {
    await this.get(actor, id);
    const secret = `whsec_${randomToken(24)}`;
    await this.db.update(webhooks).set({ secretEncrypted: this.cipher.encrypt(secret), updatedAt: this.now() }).where(eq(webhooks.id, id));
    await this.audit.log(this.db, actor, { action: 'webhook.updated', objectType: 'webhook', objectId: id, changes: { secretRotated: true } });
    return secret;
  }

  async delete(actor: ServiceActor, id: string): Promise<void> {
    await this.get(actor, id);
    await this.db.delete(webhooks).where(eq(webhooks.id, id));
    await this.audit.log(this.db, actor, { action: 'webhook.deleted', objectType: 'webhook', objectId: id });
  }

  async deliveries(actor: ServiceActor, webhookId: string, opts: { limit?: number; offset?: number } = {}): Promise<{ rows: DeliveryRow[]; totalCount: number }> {
    await this.get(actor, webhookId);
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(Math.min(opts.limit ?? 25, 100))
      .offset(opts.offset ?? 0);
    const [c] = await this.db.select({ n: sql<number>`count(*)::int` }).from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhookId));
    return { rows, totalCount: c?.n ?? 0 };
  }

  /** Manual redelivery from the dead-letter UI. Creates a fresh delivery with the same payload. */
  async redeliver(actor: ServiceActor, deliveryId: string): Promise<DeliveryRow> {
    assertCan(actor, 'workspace.webhooks');
    const [d] = await this.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId));
    if (!d) throw notFound('Delivery');
    const [row] = await this.db.insert(webhookDeliveries).values({ webhookId: d.webhookId, eventType: d.eventType, payload: d.payload }).returning();
    await this.jobs.send('webhooks', { type: 'deliver', deliveryId: row!.id });
    return row!;
  }

  /** Sends a `ping` so the owner can verify their endpoint. */
  async test(actor: ServiceActor, id: string): Promise<DeliveryRow> {
    const w = await this.get(actor, id);
    const [row] = await this.db
      .insert(webhookDeliveries)
      .values({ webhookId: w.id, eventType: 'ping', payload: { event: 'ping', createdAt: this.now().toISOString(), data: { webhookId: w.id } } })
      .returning();
    await this.deliver(row!.id);
    const [after] = await this.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, row!.id));
    return after!;
  }

  /**
   * Fan-out step, run inside the outbox transaction: one delivery row per subscribed webhook.
   * Returns delivery ids to enqueue after commit.
   */
  async createDeliveries(executor: DbOrTx, eventType: WebhookEventType, data: Record<string, unknown>): Promise<string[]> {
    const hooks = await executor
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.enabled, true), sql`${eventType} = any(${webhooks.eventTypes})`));
    if (!hooks.length) return [];
    const ids: string[] = [];
    for (const h of hooks) {
      const [row] = await executor.insert(webhookDeliveries).values({ webhookId: h.id, eventType, payload: {} }).returning({ id: webhookDeliveries.id });
      const payload: WebhookPayload = { id: row!.id, event: eventType, createdAt: this.now().toISOString(), data };
      let json = JSON.stringify(payload);
      if (json.length > MAX_PAYLOAD) {
        json = JSON.stringify({ ...payload, data: { truncated: true, id: data.id ?? null, identifier: data.identifier ?? null } });
      }
      await executor.update(webhookDeliveries).set({ payload: JSON.parse(json) }).where(eq(webhookDeliveries.id, row!.id));
      ids.push(row!.id);
    }
    return ids;
  }

  /** Job handler: one attempt; schedules the next retry or dead-letters (SPEC §6.4). */
  async deliver(deliveryId: string): Promise<void> {
    const [d] = await this.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId));
    if (!d || d.status === 'success' || d.status === 'dead') return;
    const [hook] = await this.db.select().from(webhooks).where(eq(webhooks.id, d.webhookId));
    if (!hook) return;
    const body = JSON.stringify(d.payload);
    const attempt = d.attempt + 1;
    const started = Date.now();
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const address = await resolvePublicUrl(hook.url, { allowPrivate: this.config.allowPrivateWebhookTargets });
      const secret = this.cipher.decrypt(hook.secretEncrypted);
      const headers = {
          'content-type': 'application/json',
          'user-agent': 'Velocity-Webhooks/1.0',
          'x-velocity-event': d.eventType,
          'x-velocity-delivery-id': d.id,
          'x-velocity-signature': `sha256=${hmacSha256Hex(secret, body)}`,
      };
      if (this.fetchImpl !== fetch) {
        const res = await this.fetchImpl(hook.url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
        statusCode = res.status;
        await res.body?.cancel().catch(() => {});
      } else if (address) {
        statusCode = await postPinnedWebhook(hook.url, address, headers, body);
      } else {
        const res = await this.fetchImpl(hook.url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
        statusCode = res.status;
        await res.body?.cancel().catch(() => {});
      }
      if (statusCode < 200 || statusCode >= 300) error = `HTTP ${statusCode}`;
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 500) : 'Delivery failed';
    }
    const durationMs = Date.now() - started;
    if (!error) {
      await this.db.update(webhookDeliveries).set({ status: 'success', statusCode, attempt, durationMs, deliveredAt: this.now(), error: null, nextRetryAt: null }).where(eq(webhookDeliveries.id, d.id));
      return;
    }
    if (attempt >= MAX_ATTEMPTS) {
      await this.db.update(webhookDeliveries).set({ status: 'dead', statusCode, attempt, durationMs, error, nextRetryAt: null }).where(eq(webhookDeliveries.id, d.id));
      return;
    }
    const delay = BACKOFF[attempt - 1] ?? 3600;
    await this.db
      .update(webhookDeliveries)
      .set({ status: 'failed', statusCode, attempt, durationMs, error, nextRetryAt: new Date(this.now().getTime() + delay * 1000) })
      .where(eq(webhookDeliveries.id, d.id));
    await this.jobs.send('webhooks', { type: 'deliver', deliveryId: d.id }, { startAfterSeconds: delay, singletonKey: `${d.id}:${attempt}` });
  }

  /** Maintenance: re-enqueue deliveries whose job was lost (crash between commit and send). */
  async sweepPending(): Promise<number> {
    const rows = await this.db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        sql`(${webhookDeliveries.status} = 'pending' and ${webhookDeliveries.createdAt} < now() - interval '5 minutes')
          or (${webhookDeliveries.status} = 'failed' and ${webhookDeliveries.nextRetryAt} < now() - interval '10 minutes')`,
      )
      .limit(500);
    for (const r of rows) await this.jobs.send('webhooks', { type: 'deliver', deliveryId: r.id }, { singletonKey: `sweep:${r.id}` });
    return rows.length;
  }

  async deliveriesByIds(ids: string[]): Promise<DeliveryRow[]> {
    if (!ids.length) return [];
    return this.db.select().from(webhookDeliveries).where(inArray(webhookDeliveries.id, ids));
  }
}
