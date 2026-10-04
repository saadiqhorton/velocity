import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import pino from 'pino';
import { inject } from 'vitest';
import { createServices, createDb, LocalDiskDriver, MemoryJobQueue, memberActor } from '../../src/index';
import type { AppConfig, ServiceActor, Services } from '../../src/index';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://velocity:velocity@localhost:54320/postgres';

export interface Harness {
  services: Services;
  pool: pg.Pool;
  jobs: MemoryJobQueue;
  config: AppConfig;
  clock: { now: Date | null };
  dbName: string;
  close(): Promise<void>;
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dir = mkdtempSync(join(tmpdir(), 'velocity-test-'));
  return {
    appUrl: 'http://localhost:3000',
    appSecret: 'test-secret-test-secret-test-secret-0123456789',
    uploadDir: join(dir, 'uploads'),
    maxUploadMb: 25,
    exportDir: join(dir, 'exports'),
    allowPrivateWebhookTargets: true,
    disableSignup: true,
    github: { appId: null, privateKey: null, webhookSecret: null, clientSecret: null, appSlug: null },
    mcp: { httpEnabled: false, httpToken: null },
    clamav: null,
    ...overrides,
  };
}

/** A fresh database cloned from the migrated template, plus fully wired services. */
export async function createHarness(overrides: Partial<AppConfig> = {}): Promise<Harness> {
  const dbName = `velocity_t_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${dbName} template ${inject('templateDb')}`);
  await admin.end();
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  const pool = new pg.Pool({ connectionString: u.toString(), max: 10 });
  const jobs = new MemoryJobQueue();
  const config = testConfig(overrides);
  const clock: { now: Date | null } = { now: null };
  const services = createServices({
    db: createDb(pool),
    pool,
    config,
    jobs,
    storage: new LocalDiskDriver(config.uploadDir),
    logger: pino({ level: 'silent' }),
    now: () => clock.now ?? new Date(),
  });
  return {
    services,
    pool,
    jobs,
    config,
    clock,
    dbName,
    async close() {
      await pool.end();
      rmSync(join(config.uploadDir, '..'), { recursive: true, force: true });
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${dbName} with (force)`);
      await a.end();
    },
  };
}

export const PASSWORD = 'correct-horse-battery-staple';

/** Owner + workspace via the first-run wizard path. */
export async function setupOwner(h: Harness, username = 'owner'): Promise<ServiceActor> {
  const s = await h.services.auth.setupWorkspace({ workspaceName: 'Acme', username, password: PASSWORD, name: 'Olivia Owner' }, { ip: '127.0.0.1' });
  await h.services.labels.ensureDefaults();
  return memberActor(s.user);
}

export async function addMember(h: Harness, owner: ServiceActor, username: string): Promise<ServiceActor> {
  const inv = await h.services.auth.createInvite(owner, { name: username });
  const s = await h.services.auth.acceptInvite({ token: inv.token, username, password: PASSWORD, name: username }, { ip: '127.0.0.1' });
  return memberActor(s.user);
}

export function apiActor(base: ServiceActor, scope: 'read' | 'write', apiKeyId = '00000000-0000-7000-8000-000000000001'): ServiceActor {
  return { ...base, via: 'api_key', scope, kind: 'api_key', apiKeyId };
}
