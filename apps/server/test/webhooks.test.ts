import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { createHarness, setupOwner } from '../../../packages/services/test/helpers/harness';
import type { Harness } from '../../../packages/services/test/helpers/harness';

let h: Harness | undefined;
afterEach(async () => { await h?.close(); h = undefined; });

it('delivers HMAC payloads, schedules all retries, dead-letters, and redelivers to a real receiver', async () => {
  h = await createHarness();
  const owner = await setupOwner(h);
  let responseCode = 503;
  const received: { body: string; signature: string; id: string; event: string }[] = [];
  const receiver = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push({ body: Buffer.concat(chunks).toString(), signature: String(req.headers['x-velocity-signature']), id: String(req.headers['x-velocity-delivery-id']), event: String(req.headers['x-velocity-event']) });
    res.writeHead(responseCode); res.end();
  });
  await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
  const address = receiver.address();
  if (!address || typeof address === 'string') throw new Error('Receiver address missing');
  try {
    const hook = await h.services.webhooks.create(owner, { url: `http://127.0.0.1:${address.port}`, eventTypes: ['issue.created'] });
    const [id] = await h.services.webhooks.createDeliveries(h.services.deps.db, 'issue.created', { id: 'test', title: 'Signed issue' });
    const delays = [60, 300, 900, 1800, 3600];
    h.clock.now = new Date('2026-01-01T00:00:00Z');
    for (let attempt = 1; attempt <= 6; attempt++) {
      await h.services.webhooks.deliver(id!);
      const [row] = await h.services.webhooks.deliveriesByIds([id!]);
      expect(row).toMatchObject({ attempt, status: attempt === 6 ? 'dead' : 'failed', statusCode: 503 });
      expect(row!.nextRetryAt?.getTime() ?? null).toBe(attempt === 6 ? null : h.clock.now.getTime() + delays[attempt - 1]! * 1000);
    }
    expect(received).toHaveLength(6);
    for (const request of received) {
      expect(request.signature).toBe(`sha256=${createHmac('sha256', hook.secret).update(request.body).digest('hex')}`);
      expect(request.id).toBe(id);
      expect(request.event).toBe('issue.created');
    }
    await h.services.webhooks.deliver(id!);
    expect(received).toHaveLength(6);
    responseCode = 204;
    const retry = await h.services.webhooks.redeliver(owner, id!);
    expect(retry.id).not.toBe(id);
    await h.services.webhooks.deliver(retry.id);
    expect((await h.services.webhooks.deliveriesByIds([retry.id]))[0]).toMatchObject({ status: 'success', attempt: 1 });
    expect(received[6]!.body).toBe(received[0]!.body);
  } finally { await new Promise<void>(resolve => receiver.close(() => resolve())); }
});

it('blocks private webhook targets at registration and again at delivery', async () => {
  h = await createHarness({ allowPrivateWebhookTargets: false });
  const owner = await setupOwner(h);
  for (const url of ['http://127.0.0.1:1', 'http://[::1]:1', 'http://169.254.169.254/latest/meta-data']) {
    await expect(h.services.webhooks.create(owner, { url, eventTypes: ['issue.created'] })).rejects.toMatchObject({ code: 'VALIDATION' });
  }
  // A pre-existing record must not bypass the delivery-time check after configuration changes.
  h.config.allowPrivateWebhookTargets = true;
  const hook = await h.services.webhooks.create(owner, { url: 'http://127.0.0.1:1', eventTypes: ['issue.created'] });
  h.config.allowPrivateWebhookTargets = false;
  let fetched = false;
  h.services.webhooks.fetchImpl = async () => { fetched = true; return new Response(); };
  const row = await h.services.webhooks.test(owner, hook.webhook.id);
  expect(fetched).toBe(false);
  expect(row.status).toBe('failed');
});
