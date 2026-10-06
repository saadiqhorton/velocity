import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createDb, createServices, LocalDiskDriver, MemoryJobQueue } from '../../src/index';
import type { ServiceActor } from '../../src/index';
import type { Harness } from '../helpers/harness';
import { addMember, createHarness, setupOwner } from '../helpers/harness';

let h: Harness;
let owner: ServiceActor;
let member: ServiceActor;

beforeAll(async () => {
  // No env credentials: exactly the self-hoster who wants in-app setup.
  h = await createHarness({ github: { appId: null, privateKey: null, webhookSecret: null, clientSecret: null, appSlug: null } });
  owner = await setupOwner(h);
  member = await addMember(h, owner, 'mia');
});
afterAll(async () => h.close());

describe('github app manifest setup', () => {
  it('is unconfigured until the manifest is confirmed', async () => {
    const status = await h.services.github.setupStatus();
    expect(status).toEqual({ configured: false, source: null, appSlug: null, appName: null, storedAppUnreadable: false });
  });

  it('builds a manifest scoped to the request host and stores the App encrypted after the exchange', async () => {
    const begin = await h.services.github.beginManifest(owner, { organization: 'acme' });
    expect(begin.action).toContain('https://github.com/organizations/acme/settings/apps/new?state=');
    const manifest = JSON.parse(begin.manifest) as { hook_attributes: { url: string }; default_permissions: Record<string, string>; default_events: string[]; public: boolean };
    expect(manifest.hook_attributes.url).toBe('http://localhost:3000/api/github/webhook');
    expect(manifest.public).toBe(false);
    expect(manifest.default_permissions).toEqual({ issues: 'write', pull_requests: 'read', metadata: 'read' });
    expect(manifest.default_events).toEqual(expect.arrayContaining(['pull_request', 'push', 'issues']));
    const state = new URL(begin.action).searchParams.get('state') ?? '';

    // GitHub returns the App's credentials from the one-time code exchange.
    h.services.github.fetchImpl = (async () =>
      new Response(
        JSON.stringify({ id: 98765, slug: 'velocity-acme', name: 'Velocity (acme)', client_id: 'Iv1.abc', client_secret: 'cs', webhook_secret: 'whsec', pem: '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----' }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    await h.services.github.confirmManifest(owner, { code: 'one-time-code', state });
    const status = await h.services.github.setupStatus();
    expect(status).toEqual({ configured: true, source: 'database', appSlug: 'velocity-acme', appName: 'Velocity (acme)', storedAppUnreadable: false });
    expect(await h.services.github.installUrl()).toBe('https://github.com/apps/velocity-acme/installations/new');

    // The private key is never stored in plaintext.
    const row = await h.pool.query<{ private_key_encrypted: string; webhook_secret_encrypted: string }>('select private_key_encrypted, webhook_secret_encrypted from github_app where id = 1');
    expect(row.rows[0]?.private_key_encrypted.startsWith('v1:')).toBe(true);
    expect(row.rows[0]?.private_key_encrypted).not.toContain('PRIVATE KEY');
    expect(row.rows[0]?.webhook_secret_encrypted).not.toContain('whsec');
  });

  it('rejects a bad state and an owner-only actor', async () => {
    await expect(h.services.github.confirmManifest(owner, { code: 'x', state: 'forged.state.sig' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(h.services.github.beginManifest(member, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.services.github.removeApp(member)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('removes the stored App and falls back to the environment', async () => {
    await h.services.github.removeApp(owner);
    const status = await h.services.github.setupStatus();
    expect(status).toEqual({ configured: false, source: null, appSlug: null, appName: null, storedAppUnreadable: false });
    const count = await h.pool.query<{ n: number }>('select count(*)::int as n from github_app');
    expect(count.rows[0]?.n).toBe(0);
  });

  it('uses environment credentials when no in-app App exists', async () => {
    const envH = await createHarness({ github: { appId: '42', privateKey: 'env-key', webhookSecret: 'env-secret', clientSecret: null, appSlug: 'env-slug' } });
    try {
      const status = await envH.services.github.setupStatus();
      expect(status).toEqual({ configured: true, source: 'environment', appSlug: 'env-slug', appName: null, storedAppUnreadable: false });
      expect(await envH.services.github.installUrl()).toBe('https://github.com/apps/env-slug/installations/new');
    } finally {
      await envH.close();
    }
  });

  it('falls back to env when APP_SECRET changed, and lets the owner remove the unreadable App', async () => {
    const rh = await createHarness({ github: { appId: null, privateKey: null, webhookSecret: null, clientSecret: null, appSlug: null } });
    try {
      const ro = await setupOwner(rh);
      await rh.services.github.saveAppFromManifest(ro, { appId: 7, slug: 'old-app', name: 'Old', clientId: 'c', clientSecret: 'cs', webhookSecret: 'wh', pem: 'PEM' });

      const config = { ...rh.config, appSecret: 'rotated-secret-rotated-secret-0123456789', github: { appId: '42', privateKey: 'env-key', webhookSecret: 'env-secret', clientSecret: null, appSlug: 'env-slug' } };
      const rotated = createServices({ db: createDb(rh.pool), pool: rh.pool, config, jobs: new MemoryJobQueue(), storage: new LocalDiskDriver(config.uploadDir), logger: pino({ level: 'silent' }) });
      await expect(rotated.github.resolvedConfig()).resolves.toMatchObject({ source: 'environment', appId: '42', webhookSecret: 'env-secret' });
      expect(await rotated.github.isConfigured()).toBe(true);
      expect(await rotated.github.setupStatus()).toMatchObject({ configured: true, source: 'environment', storedAppUnreadable: true });

      await rotated.github.removeApp(ro);
      const count = await rh.pool.query<{ n: number }>('select count(*)::int as n from github_app');
      expect(count.rows[0]?.n).toBe(0);
      expect(await rotated.github.setupStatus()).toMatchObject({ source: 'environment', storedAppUnreadable: false });
    } finally {
      await rh.close();
    }
  });
});
