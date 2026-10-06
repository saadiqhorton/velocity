import { mkdirSync, mkdtempSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveAppUrl, loadConfig, resolveAppSecret } from '../src/config';
import type { SecretFs } from '../src/config';

const tmp = () => mkdtempSync(join(tmpdir(), 'velocity-cfg-'));
const base = (dir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  DATABASE_URL: 'postgres://x/y',
  APP_SECRET_FILE: join(dir, 'secret'),
  ...extra,
});

describe('APP_URL derivation', () => {
  it('uses https://CADDY_DOMAIN for a real hostname', () => {
    expect(deriveAppUrl({ CADDY_DOMAIN: 'velocity.example.com' })).toBe('https://velocity.example.com');
    expect(loadConfig(base(tmp(), { CADDY_DOMAIN: 'v.example.com' })).app.appUrl).toBe('https://v.example.com');
    expect(loadConfig(base(tmp(), { CADDY_DOMAIN: 'v.example.com' })).secureCookies).toBe(true);
  });
  it('falls back to localhost for empty or port-only CADDY_DOMAIN', () => {
    expect(deriveAppUrl({ CADDY_DOMAIN: ':80', NODE_ENV: 'production' })).toBe('http://localhost');
    expect(deriveAppUrl({ CADDY_DOMAIN: '', NODE_ENV: 'production' })).toBe('http://localhost');
    expect(deriveAppUrl({ NODE_ENV: 'production' })).toBe('http://localhost');
    expect(deriveAppUrl({})).toBe('http://localhost:3000');
  });
  it('an explicit APP_URL wins', () => {
    const c = loadConfig(base(tmp(), { APP_URL: 'http://tracker.lan/', CADDY_DOMAIN: 'v.example.com' }));
    expect(c.app.appUrl).toBe('http://tracker.lan');
  });
});

describe('APP_SECRET resolution', () => {
  it('explicit APP_SECRET wins and keeps the 32-char validation', () => {
    const dir = tmp();
    expect(loadConfig(base(dir, { APP_SECRET: 'a'.repeat(40) })).app.appSecret).toBe('a'.repeat(40));
    expect(() => loadConfig(base(dir, { APP_SECRET: 'short' }))).toThrow(/at least 32 characters/);
  });
  it('generates a 0600 file once and reuses it', () => {
    const dir = tmp();
    const first = loadConfig(base(dir));
    expect(first.appSecretGenerated).toBe(true);
    expect(first.app.appSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(join(dir, 'secret')).mode & 0o777).toBe(0o600);
    const second = loadConfig(base(dir));
    expect(second.appSecretGenerated).toBe(false);
    expect(second.app.appSecret).toBe(first.app.appSecret);
  });
  it('creates missing parent directories', () => {
    const dir = tmp();
    const c = loadConfig({ DATABASE_URL: 'postgres://x/y', APP_SECRET_FILE: join(dir, 'a/b/secret') });
    expect(readFileSync(join(dir, 'a/b/secret'), 'utf8')).toBe(c.app.appSecret);
  });
  it('re-reads the file when another process wins the create race (EEXIST)', () => {
    const winner = 'f'.repeat(64);
    let reads = 0;
    const fs: SecretFs = {
      mkdirSync: () => undefined,
      readFileSync: () => {
        if (reads++ === 0) throw Object.assign(new Error('nope'), { code: 'ENOENT' });
        return `${winner}\n`;
      },
      writeFileSync: () => {
        throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      },
    };
    expect(resolveAppSecret({ APP_SECRET_FILE: '/x/secret' }, fs)).toMatchObject({ secret: winner, generated: false });
  });
  it('rejects a too-short secret file with a pointer to the file', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'secret'), 'tiny');
    expect(() => loadConfig(base(dir))).toThrow(/at least 32 characters[\s\S]*secret/);
  });
  it('explains an unwritable location', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'secret')); // a directory where the file should go -> EISDIR on read
    expect(() => loadConfig(base(dir))).toThrow(/APP_SECRET_FILE/);
  });
});

describe('backup config', () => {
  it('defaults: enabled only in production', () => {
    const dir = tmp();
    expect(loadConfig(base(dir)).backup).toEqual({ enabled: false, schedule: '0 3 * * *', retentionDays: 14 });
    expect(loadConfig(base(dir, { NODE_ENV: 'production' })).backup.enabled).toBe(true);
    expect(loadConfig(base(dir, { NODE_ENV: 'production', BACKUP_ENABLED: 'false' })).backup.enabled).toBe(false);
    expect(loadConfig(base(dir, { BACKUP_ENABLED: '1', BACKUP_SCHEDULE: '*/5 * * * *', BACKUP_RETENTION_DAYS: '3' })).backup).toEqual({ enabled: true, schedule: '*/5 * * * *', retentionDays: 3 });
    expect(loadConfig(base(dir, { BACKUP_SCHEDULE: '', BACKUP_RETENTION_DAYS: '' })).backup.retentionDays).toBe(14);
  });
});
