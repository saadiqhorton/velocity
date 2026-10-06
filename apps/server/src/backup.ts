import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';

export const BACKUP_QUEUE = 'backups';
const BACKUP_FILE = /^velocity-.+\.dump$/;

export interface BackupTarget {
  databaseUrl: string;
  backupDir: string;
}

/** pg_dump (custom format) into backupDir; resolves with the absolute file path. */
export async function backupDatabase(target: BackupTarget, logger?: Logger, reason = 'backup'): Promise<string> {
  mkdirSync(target.backupDir, { recursive: true });
  const file = resolve(join(target.backupDir, `velocity-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`));
  logger?.info({ file }, `backing up database (${reason})`);
  // Dumps hold password hashes and tokens: create owner-only before pg_dump writes into it.
  writeFileSync(file, '', { mode: 0o600, flag: 'wx' });
  await new Promise<void>((res, rej) => {
    const p = spawn('pg_dump', ['--format=custom', `--file=${file}`, `--dbname=${target.databaseUrl}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += String(d)));
    p.on('error', rej);
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`pg_dump failed (${code}): ${err.slice(0, 500)}`))));
  });
  chmodSync(file, 0o600);
  return file;
}

export interface BackupFile {
  name: string;
  path: string;
  size: number;
  mtime: Date;
}

/** `velocity-*.dump` files in dir, newest first. Missing directory means no backups. */
export function listBackups(dir: string): BackupFile[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: BackupFile[] = [];
  for (const name of names) {
    if (!BACKUP_FILE.test(name)) continue;
    const path = resolve(join(dir, name));
    const st = statSync(path);
    if (st.isFile()) out.push({ name, path, size: st.size, mtime: st.mtime });
  }
  return out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime() || b.name.localeCompare(a.name));
}

/** Delete `velocity-*.dump` files older than retentionDays; never touches anything else. */
export function pruneBackups(dir: string, retentionDays: number, now = new Date()): string[] {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const removed: string[] = [];
  for (const f of listBackups(dir)) {
    if (f.mtime.getTime() < cutoff) {
      unlinkSync(f.path);
      removed.push(f.name);
    }
  }
  return removed;
}

export interface BackupJobConfig extends BackupTarget {
  backup: { enabled: boolean; schedule: string; retentionDays: number };
}

/** Subset of PgBoss used here, so tests can pass a recording fake. */
export type BackupBoss = Pick<PgBoss, 'getQueue' | 'createQueue' | 'work' | 'schedule' | 'unschedule'>;

/** Register the nightly backup worker + cron. No-op when BACKUP_ENABLED is off. */
export async function registerBackupSchedule(boss: BackupBoss, config: BackupJobConfig, logger: Logger, run: typeof backupDatabase = backupDatabase): Promise<boolean> {
  if (!config.backup.enabled) {
    // Backups were switched off after having been on: drop the stale cron so jobs don't pile up unworked.
    if (await boss.getQueue(BACKUP_QUEUE)) await boss.unschedule(BACKUP_QUEUE);
    return false;
  }
  if (!(await boss.getQueue(BACKUP_QUEUE))) {
    await boss.createQueue(BACKUP_QUEUE, { retryLimit: 1, retryDelay: 300, expireInSeconds: 3600 });
  }
  await boss.work(BACKUP_QUEUE, async () => {
    try {
      const file = await run(config, logger, 'scheduled');
      const removed = pruneBackups(config.backupDir, config.backup.retentionDays);
      logger.info({ file, pruned: removed.length }, 'scheduled backup complete');
    } catch (err) {
      logger.error({ err }, 'scheduled backup failed');
      throw err;
    }
  });
  await boss.schedule(BACKUP_QUEUE, config.backup.schedule, {}, { tz: 'UTC' });
  return true;
}
