import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '@velocity/schema/migrate';

export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://velocity:velocity@localhost:54320/postgres';

declare module 'vitest' {
  export interface ProvidedContext {
    templateDb: string;
  }
}

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/**
 * Migrate a template database once per vitest run; each test file clones it (fast, isolated).
 * The template name is unique per run so parallel runs (turbo, CI matrix) never collide.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const templateDb = `velocity_tpl_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${templateDb}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: withDb(ADMIN_URL, templateDb), max: 2 });
  await runMigrations(pool);
  await pool.end();
  project.provide('templateDb', templateDb);
  return async () => {
    const a = new pg.Client({ connectionString: ADMIN_URL });
    await a.connect();
    await a.query(`drop database if exists ${templateDb} with (force)`).catch(() => {});
    await a.end();
  };
}
