import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

/** Arbitrary constant key for the migration advisory lock (SPEC §5.9: idempotent, lock-guarded). */
const MIGRATION_LOCK_KEY = 4_206_942_017;

export const defaultMigrationsFolder = (): string => fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Runs pending migrations under a session-level advisory lock so concurrent app
 * containers (scale profile) can't race. Safe to call on every boot.
 */
export async function runMigrations(pool: Pool, migrationsFolder = defaultMigrationsFolder()): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle(client), { migrationsFolder });
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
