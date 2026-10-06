import { afterEach, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PASSWORD, setupOwner, testConfig } from '../../../packages/services/test/helpers/harness';
import { boot } from './helpers';
import type { RunningApp } from './helpers';

let running: RunningApp | undefined;
afterEach(async () => { await running?.close(); running = undefined; });
const setup = `mutation { setupWorkspace(input: { workspaceName: "Test", username: "owner", password: "${PASSWORD}" }) { user { id } csrfToken } }`;

describe('HTTP boundary (SPEC §7.1, §6.3)', () => {
  it('sets secure cookies, enforces CSRF, revokes logout, and serves health checks', async () => {
    running = await boot({ secureCookies: true });
    const { response, body } = await running.gql(setup);
    expect(body.errors).toBeUndefined();
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/vel_session=.*HttpOnly; Secure/);
    expect(cookies[0]).toContain('SameSite=Lax');
    expect(cookies[1]).not.toContain('HttpOnly');
    const cookie = cookies.map(c => c.split(';')[0]).join('; ');
    const csrf = (body.data?.setupWorkspace as { csrfToken: string }).csrfToken;
    for (const headers of [{ cookie }, { cookie, 'x-csrf-token': 'wrong' }] as Record<string, string>[]) {
      const rejected = await running.gql('{ viewer { id } }', {}, headers);
      expect(rejected.response.status).toBe(403);
      expect(rejected.body.errors?.[0]?.extensions.code).toBe('FORBIDDEN');
    }
    expect((await running.gql('{ viewer { id } }', {}, { cookie, 'x-csrf-token': csrf })).body.errors).toBeUndefined();
    const logout = await running.gql('mutation { logout }', {}, { cookie, 'x-csrf-token': csrf });
    expect(logout.response.headers.getSetCookie().every(c => c.includes('Max-Age=0'))).toBe(true);
    expect((await running.gql('{ viewer { id } }', {}, { cookie })).body.data?.viewer).toBeNull();
    expect((await fetch(`${running.base}/healthz`)).status).toBe(200);
    expect((await fetch(`${running.base}/readyz`)).status).toBe(200);
  });

  it('returns 429 and actionable headers after ten credential attempts, including commented field syntax', async () => {
    running = await boot();
    const query = 'mutation { login # legal GraphQL comment\n(input: {login:"unknown", password:"not-a-password"}) { csrfToken } }';
    for (let i = 0; i < 10; i++) expect((await running.gql(query)).response.status).not.toBe(429);
    const denied = await running.gql(query);
    expect(denied.response.status).toBe(429);
    expect(denied.body.errors?.[0]?.extensions.code).toBe('RATE_LIMITED');
    expect(Number(denied.response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(denied.response.headers.get('x-ratelimit-limit')).toBe('10');
    expect(denied.response.headers.get('x-ratelimit-remaining')).toBe('0');
  });

  it('applies API key rate limits and scopes without requiring CSRF', async () => {
    running = await boot({ rateLimit: { perMinute: 2, burstPerSecond: 50 } });
    const owner = await setupOwner(running.h);
    const { plaintext } = await running.app.services.apiKeys.create(owner, { name: 'read', scope: 'read' });
    const headers = { authorization: plaintext };
    expect((await running.gql('{ viewer { id } }', {}, headers)).body.errors).toBeUndefined();
    expect((await running.gql('mutation { createTeam(input:{name:"No", key:"NO"}) { id } }', {}, headers)).body.errors?.[0]?.extensions.code).toBe('FORBIDDEN');
    const denied = await running.gql('{ viewer { id } }', {}, headers);
    expect(denied.response.status).toBe(429);
    expect(denied.response.headers.get('x-ratelimit-limit')).toBe('2');
    expect(Number(denied.response.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('protects metrics by token and rejects proxied access without a configured token', async () => {
    running = await boot({ metricsToken: 'metrics-test' });
    expect((await fetch(`${running.base}/metrics`)).status).toBe(403);
    const result = await fetch(`${running.base}/metrics`, { headers: { authorization: 'Bearer metrics-test' } });
    expect(result.status).toBe(200);
    expect(await result.text()).toContain('velocity_');
    await running.close(); running = undefined;
    running = await boot();
    expect((await fetch(`${running.base}/metrics`, { headers: { 'x-forwarded-for': '127.0.0.1' } })).status).toBe(403);
  });

  it('serves attachments with valid signatures or sessions and rejects tampering/expiry', async () => {
    running = await boot();
    const owner = await setupOwner(running.h);
    const a = await running.app.services.attachments.upload(owner, { filename: 'test.txt', mime: 'text/plain', data: Buffer.from('hello') });
    expect((await fetch(`${running.base}/files/${a.id}`)).status).toBe(401);
    const signed = running.app.services.attachments.signedPath(a.id);
    const good = await fetch(running.base + signed);
    expect(await good.text()).toBe('hello');
    expect(good.headers.get('content-disposition')).toContain('attachment');
    expect(good.headers.get('content-security-policy')).toContain('sandbox');
    expect((await fetch(running.base + signed.replace('sig=', 'sig=x'))).status).toBe(401);
    expect((await fetch(running.base + running.app.services.attachments.signedPath(a.id, -10))).status).toBe(401);
    const login = await running.app.services.auth.login({ login: 'owner', password: PASSWORD }, {});
    expect((await fetch(`${running.base}/files/${a.id}`, { headers: { cookie: `vel_session=${login.token}` } })).status).toBe(200);
  });

  it('uploads and serves a re-encoded avatar through multipart GraphQL, replacing old storage', async () => {
    running = await boot();
    const owner = await setupOwner(running.h);
    const login = await running.app.services.auth.login({ login: 'owner', password: PASSWORD }, {});
    const headers = { cookie: `vel_session=${login.token}`, 'x-csrf-token': login.csrfToken };
    const png = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 20, g: 40, b: 60 } } }).png().toBuffer();
    const upload = async (data: Buffer) => {
      const form = new FormData();
      form.set('operations', JSON.stringify({ query: 'mutation($file: File!) { uploadAvatar(file: $file) { id avatarUrl } }', variables: { file: null } }));
      form.set('map', JSON.stringify({ '0': ['variables.file'] }));
      form.set('0', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'avatar.png');
      return fetch(`${running!.base}/graphql`, { method: 'POST', headers, body: form });
    };
    const result = await (await upload(png)).json() as { data: { uploadAvatar: { avatarUrl: string } }; errors?: unknown };
    expect(result.errors).toBeUndefined();
    const url = running.base + result.data.uploadAvatar.avatarUrl;
    expect((await fetch(url)).status).toBe(401);
    const image = await fetch(url, { headers });
    expect(image.headers.get('content-type')).toBe('image/webp');
    expect(await sharp(Buffer.from(await image.arrayBuffer())).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
    const oldPath = (await running.app.services.users.get(owner.userId))!.avatarPath!;
    expect((await (await upload(png)).json() as { errors?: unknown }).errors).toBeUndefined();
    expect(await running.app.services.deps.storage.size(oldPath)).toBeNull();
    const bad = await (await upload(Buffer.from('<svg></svg>'))).json() as { errors: { extensions: { code: string } }[] };
    expect(bad.errors[0]?.extensions.code).toBe('VALIDATION');
    await expect(running.app.services.users.uploadAvatar({ ...owner, scope: 'read', via: 'api_key' }, png)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('verifies GitHub signatures, records dedupe, and rejects invalid payloads', async () => {
    const app = testConfig(); app.github.webhookSecret = 'github-secret';
    running = await boot({ app });
    const payload = JSON.stringify({ zen: 'test' });
    const headers = { 'content-type': 'application/json', 'x-github-delivery': randomUUID(), 'x-github-event': 'ping', 'x-hub-signature-256': `sha256=${createHmac('sha256', 'github-secret').update(payload).digest('hex')}` };
    const send = (h = headers) => fetch(`${running!.base}/api/github/webhook`, { method: 'POST', headers: h, body: payload });
    expect((await send({ ...headers, 'x-hub-signature-256': 'sha256=bad' })).status).toBe(401);
    expect((await send()).status).toBe(202);
    expect(await (await send()).json()).toMatchObject({ status: 'duplicate' });
    expect((await running.app.pool.query('select count(*)::int as n from github_events')).rows[0].n).toBe(1);
    expect((await fetch(`${running.base}/api/github/webhook`)).status).toBe(405);
  });

  it('redirects the GitHub post-install callback to the SPA settings route', async () => {
    running = await boot();
    const get = (qs: string) => fetch(`${running!.base}/api/github/setup${qs}`, { redirect: 'manual' });
    const ok = await get('?installation_id=12345&setup_action=install');
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toBe('/settings/github?installation_id=12345');
    expect((await get('')).headers.get('location')).toBe('/settings/github');
    expect((await get('?installation_id=abc')).headers.get('location')).toBe('/settings/github');
    expect((await get('?installation_id=1%26x%3D2')).headers.get('location')).toBe('/settings/github');
  });
});
