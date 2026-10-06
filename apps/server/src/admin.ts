import { randomBytes } from 'node:crypto';
import { isNull, or, eq, asc } from 'drizzle-orm';
import pg from 'pg';
import pino from 'pino';
import { users } from '@velocity/schema';
import { LocalDiskDriver, MemoryJobQueue, createDb, createServices, systemActor } from '@velocity/services';
import { backupDatabase, listBackups } from './backup';
import { loadConfig } from './config';
import type { ServerConfig } from './config';

export const USAGE = `Usage: node dist/admin-cli.js <command>

Commands:
  reset-password <username-or-email>  Set a new random password (or read one from stdin when piped);
                                      revokes the user's sessions.
  backup                              Run a database backup now and print the file path.
  backups                             List backups, newest first: <filename>\\t<size bytes>\\t<ISO mtime>
  list-users                          List users: <username>\\t<email>\\t<role>
  help                                Show this message.
`;

export type Command =
  | { name: 'help' }
  | { name: 'backup' }
  | { name: 'backups' }
  | { name: 'list-users' }
  | { name: 'reset-password'; login: string }
  | { name: 'error'; message: string };

export function parseArgs(argv: string[]): Command {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') return { name: 'help' };
  if (cmd === 'backup' || cmd === 'backups' || cmd === 'list-users') {
    return rest.length ? { name: 'error', message: `${cmd} takes no arguments.` } : { name: cmd };
  }
  if (cmd === 'reset-password') {
    if (rest.length !== 1 || !rest[0]) return { name: 'error', message: 'reset-password requires exactly one argument: <username-or-email>.' };
    return { name: 'reset-password', login: rest[0] };
  }
  return { name: 'error', message: `Unknown command: ${cmd}` };
}

export interface AdminIo {
  out(line: string): void;
  err(line: string): void;
  /** Piped stdin contents, or null when stdin is a TTY. */
  readStdin(): Promise<string | null>;
}

export interface AdminDeps {
  io: AdminIo;
  loadConfig?: () => ServerConfig;
  backup?: typeof backupDatabase;
}

const generatePassword = (): string => randomBytes(18).toString('base64url');

/** Runs one command and returns the process exit code. */
export async function runAdmin(argv: string[], deps: AdminDeps): Promise<number> {
  const { io } = deps;
  const cmd = parseArgs(argv);
  if (cmd.name === 'help') {
    io.out(USAGE.trimEnd());
    return 0;
  }
  if (cmd.name === 'error') {
    io.err(`${cmd.message}\n\n${USAGE.trimEnd()}`);
    return 2;
  }
  let config: ServerConfig;
  try {
    config = (deps.loadConfig ?? loadConfig)();
  } catch (err) {
    io.err((err as Error).message);
    return 1;
  }
  try {
    if (cmd.name === 'backups') {
      for (const f of listBackups(config.backupDir)) io.out(`${f.name}\t${f.size}\t${f.mtime.toISOString()}`);
      return 0;
    }
    if (cmd.name === 'backup') {
      io.out(await (deps.backup ?? backupDatabase)(config, undefined, 'manual'));
      return 0;
    }
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
    try {
      const db = createDb(pool);
      if (cmd.name === 'list-users') {
        const rows = await db.select().from(users).where(isNull(users.deletedAt)).orderBy(asc(users.createdAt));
        for (const u of rows) io.out(`${u.username}\t${u.email ?? ''}\t${u.isOwner ? 'owner' : 'member'}`);
        return 0;
      }
      const [user] = await db
        .select()
        .from(users)
        .where(or(eq(users.username, cmd.login), eq(users.email, cmd.login)))
        .limit(1);
      if (!user || user.deletedAt) {
        io.err(`No user found with username or email "${cmd.login}". Run list-users to see accounts.`);
        return 1;
      }
      const services = createServices({
        db,
        pool,
        config: config.app,
        jobs: new MemoryJobQueue(),
        storage: new LocalDiskDriver(config.app.uploadDir),
        logger: pino({ level: 'silent' }),
      });
      const piped = (await io.readStdin())?.replace(/\r?\n$/, '') ?? '';
      if (piped) {
        await services.users.setPassword(systemActor('system'), user.id, piped);
        io.out(`Password updated for ${user.username}`);
      } else {
        const password = generatePassword();
        await services.users.setPassword(systemActor('system'), user.id, password);
        io.out(`New password for ${user.username}: ${password}`);
      }
      return 0;
    } finally {
      await pool.end();
    }
  } catch (err) {
    io.err(`${cmd.name} failed: ${(err as Error).message}`);
    return 1;
  }
}
