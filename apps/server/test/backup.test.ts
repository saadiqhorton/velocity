import { chmodSync, mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { BACKUP_QUEUE, backupDatabase, listBackups, pruneBackups, registerBackupSchedule } from '../src/backup';
import type { BackupBoss } from '../src/backup';

const day = 86_400_000;
function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'velocity-bk-'));
  const now = new Date('2026-06-30T12:00:00Z');
  const put = (name: string, ageDays: number) => {
    const p = join(dir, name);
    writeFileSync(p, 'x');
    const t = new Date(now.getTime() - ageDays * day);
    utimesSync(p, t, t);
  };
  put('velocity-2026-06-01.dump', 29);
  put('velocity-2026-06-29.dump', 1);
  put('velocity-2026-06-10.dump', 20);
  put('notes.txt', 100);
  put('other-2026.dump', 100);
  put('velocity-old.dump.bak', 100);
  mkdirSync(join(dir, 'velocity-dir.dump'));
  return { dir, now };
}

describe('backup retention', () => {
  it('prunes only old velocity-*.dump files', () => {
    const { dir, now } = seed();
    const removed = pruneBackups(dir, 14, now);
    expect(removed.sort()).toEqual(['velocity-2026-06-01.dump', 'velocity-2026-06-10.dump']);
    for (const keep of ['velocity-2026-06-29.dump', 'notes.txt', 'other-2026.dump', 'velocity-old.dump.bak', 'velocity-dir.dump']) {
      expect(existsSync(join(dir, keep)), keep).toBe(true);
    }
  });
  it('lists newest first and tolerates a missing dir', () => {
    const { dir } = seed();
    expect(listBackups(dir).map((f) => f.name)).toEqual(['velocity-2026-06-29.dump', 'velocity-2026-06-10.dump', 'velocity-2026-06-01.dump']);
    expect(listBackups(join(dir, 'nope'))).toEqual([]);
  });
});

function fakeBoss(queueExists = false) {
  const boss = {
    getQueue: vi.fn(async () => (queueExists ? ({ name: BACKUP_QUEUE } as never) : null)),
    createQueue: vi.fn(async () => undefined),
    work: vi.fn(async (...args: [string, unknown]) => (args.length ? 'w' : 'w') as never),
    schedule: vi.fn(async () => undefined),
    unschedule: vi.fn(async () => undefined),
  };
  return boss;
}
const logger = pino({ level: 'silent' });

describe('backup schedule registration', () => {
  it('registers worker + cron when enabled and prunes after a successful run', async () => {
    const { dir } = seed();
    const boss = fakeBoss();
    const run = vi.fn(async () => join(dir, 'new.dump'));
    const cfg = { databaseUrl: 'x', backupDir: dir, backup: { enabled: true, schedule: '0 3 * * *', retentionDays: 1 } };
    expect(await registerBackupSchedule(boss as unknown as BackupBoss, cfg, logger, run)).toBe(true);
    expect(boss.createQueue).toHaveBeenCalledWith(BACKUP_QUEUE, expect.anything());
    expect(boss.schedule).toHaveBeenCalledWith(BACKUP_QUEUE, '0 3 * * *', {}, { tz: 'UTC' });
    const handler = boss.work.mock.calls[0]![1] as unknown as () => Promise<void>;
    await handler();
    expect(run).toHaveBeenCalledOnce();
    expect(existsSync(join(dir, 'velocity-2026-06-10.dump'))).toBe(false);
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true);
  });
  it('does not prune when the backup fails', async () => {
    const { dir } = seed();
    const boss = fakeBoss();
    const run = vi.fn(async () => {
      throw new Error('pg_dump failed');
    });
    await registerBackupSchedule(boss as unknown as BackupBoss, { databaseUrl: 'x', backupDir: dir, backup: { enabled: true, schedule: '0 3 * * *', retentionDays: 1 } }, logger, run);
    await expect((boss.work.mock.calls[0]![1] as unknown as () => Promise<void>)()).rejects.toThrow('pg_dump failed');
    expect(existsSync(join(dir, 'velocity-2026-06-01.dump'))).toBe(true);
  });
  it('schedules nothing when disabled (and drops a stale cron)', async () => {
    const boss = fakeBoss(true);
    const cfg = { databaseUrl: 'x', backupDir: '/tmp', backup: { enabled: false, schedule: '0 3 * * *', retentionDays: 14 } };
    expect(await registerBackupSchedule(boss as unknown as BackupBoss, cfg, logger)).toBe(false);
    expect(boss.schedule).not.toHaveBeenCalled();
    expect(boss.work).not.toHaveBeenCalled();
    expect(boss.unschedule).toHaveBeenCalledWith(BACKUP_QUEUE);
  });
});

describe('backupDatabase', () => {
  it('writes the dump owner-only (0600)', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'velocity-pgdump-'));
    // Fake pg_dump: write to --file=<path> like the real one (umask permitting world-read).
    writeFileSync(join(bin, 'pg_dump'), '#!/bin/sh\nfor a; do case "$a" in --file=*) printf dump > "${a#--file=}";; esac; done\n');
    chmodSync(join(bin, 'pg_dump'), 0o755);
    const prev = process.env.PATH;
    process.env.PATH = `${bin}:${prev ?? ''}`;
    try {
      const dir = join(mkdtempSync(join(tmpdir(), 'velocity-bkdir-')), 'backups');
      const file = await backupDatabase({ databaseUrl: 'postgres://x', backupDir: dir });
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      process.env.PATH = prev;
    }
  });
});
