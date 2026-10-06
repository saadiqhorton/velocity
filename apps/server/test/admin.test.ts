import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness } from '../../../packages/services/test/helpers/harness';
import type { Harness } from '../../../packages/services/test/helpers/harness';
import { parseArgs, runAdmin } from '../src/admin';
import type { AdminIo } from '../src/admin';
import { loadConfig } from '../src/config';

describe('admin CLI parsing', () => {
  it('parses commands', () => {
    expect(parseArgs([])).toEqual({ name: 'help' });
    expect(parseArgs(['help'])).toEqual({ name: 'help' });
    expect(parseArgs(['backup'])).toEqual({ name: 'backup' });
    expect(parseArgs(['backups'])).toEqual({ name: 'backups' });
    expect(parseArgs(['list-users'])).toEqual({ name: 'list-users' });
    expect(parseArgs(['reset-password', 'demo'])).toEqual({ name: 'reset-password', login: 'demo' });
  });
  it('rejects bad input', () => {
    expect(parseArgs(['reset-password']).name).toBe('error');
    expect(parseArgs(['reset-password', 'a', 'b']).name).toBe('error');
    expect(parseArgs(['backup', 'x']).name).toBe('error');
    expect(parseArgs(['wat'])).toEqual({ name: 'error', message: 'Unknown command: wat' });
  });
});

describe('admin CLI against a database', () => {
  let h: Harness;
  let backupDir: string;
  const out: string[] = [];
  const errs: string[] = [];
  const io = (stdin: string | null = null): AdminIo => ({ out: (l) => out.push(l), err: (l) => errs.push(l), readStdin: async () => stdin });
  const run = (argv: string[], stdin: string | null = null) => {
    out.length = 0;
    errs.length = 0;
    return runAdmin(argv, {
      io: io(stdin),
      loadConfig: () => {
        const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://velocity:velocity@localhost:54320/postgres');
        url.pathname = `/${h.dbName}`;
        return { ...loadConfig({ DATABASE_URL: url.toString(), APP_SECRET: h.config.appSecret, BACKUP_DIR: backupDir }), app: h.config };
      },
      backup: async () => join(backupDir, 'velocity-fake.dump'),
    });
  };

  beforeAll(async () => {
    h = await createHarness();
    backupDir = mkdtempSync(join(tmpdir(), 'velocity-admin-'));
    await h.services.auth.setupWorkspace(
      { workspaceName: 'Acme', username: 'demo', name: 'Demo', email: 'demo@example.com', password: 'correct-horse-battery-staple' },
      {},
    );
  });
  afterAll(async () => h.close());

  it('prints usage', async () => {
    expect(await run(['help'])).toBe(0);
    expect(out.join('\n')).toContain('reset-password');
  });

  it('lists users', async () => {
    expect(await run(['list-users'])).toBe(0);
    expect(out).toEqual(['demo\tdemo@example.com\towner']);
  });

  it('resets a password to a random one, by username or email, and revokes sessions', async () => {
    const session = await h.services.auth.login({ login: 'demo', password: 'correct-horse-battery-staple' }, {});
    expect(await run(['reset-password', 'demo@example.com'])).toBe(0);
    const m = /^New password for demo: (\S{20,})$/.exec(out[0] ?? '');
    expect(m).not.toBeNull();
    expect(await h.services.auth.resolveSession(session.token)).toBeNull();
    await expect(h.services.auth.login({ login: 'demo', password: 'correct-horse-battery-staple' }, {})).rejects.toThrow();
    await h.services.auth.login({ login: 'demo', password: m![1]! }, {});
    const audit = await h.pool.query("select 1 from audit_log where action = 'member.password_reset'");
    expect(audit.rowCount).toBe(1);
  });

  it('uses a password piped on stdin', async () => {
    expect(await run(['reset-password', 'DEMO'], 'a-long-piped-passphrase-42\n')).toBe(0);
    expect(out).toEqual(['Password updated for demo']);
    await h.services.auth.login({ login: 'demo', password: 'a-long-piped-passphrase-42' }, {});
  });

  it('fails clearly for an unknown user or a weak piped password', async () => {
    expect(await run(['reset-password', 'ghost'])).toBe(1);
    expect(errs.join('\n')).toMatch(/No user found.*ghost/);
    expect(await run(['reset-password', 'demo'], 'x')).toBe(1);
    expect(errs.join('\n')).toMatch(/failed/);
  });

  it('backup prints the path; backups lists newest first with the exact format', async () => {
    expect(await run(['backup'])).toBe(0);
    expect(out).toEqual([join(backupDir, 'velocity-fake.dump')]);
    const a = join(backupDir, 'velocity-a.dump');
    const b = join(backupDir, 'velocity-b.dump');
    writeFileSync(a, 'aaa');
    writeFileSync(b, 'bb');
    utimesSync(a, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    utimesSync(b, new Date('2026-02-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));
    expect(await run(['backups'])).toBe(0);
    expect(out).toEqual(['velocity-b.dump\t2\t2026-02-01T00:00:00.000Z', 'velocity-a.dump\t3\t2026-01-01T00:00:00.000Z']);
  });
});
