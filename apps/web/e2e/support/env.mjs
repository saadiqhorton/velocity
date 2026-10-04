// Shared environment resolution for the E2E harness (webServer, seed, specs).
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export const WEB_DIR = resolve(here, '..', '..');
export const REPO_DIR = resolve(WEB_DIR, '..', '..');
export const SERVER_DIR = join(REPO_DIR, 'apps', 'server');

/**
 * CI provides DATABASE_URL + APP_URL; locally we use a dedicated database and port 3200.
 * `E2E_SLOT=<1-9>` isolates parallel local runs: port 32<slot>0, database velocity_e2e_web_<slot>,
 * and their own data dir, auth file and output dir (e.g. several agents each running one spec).
 */
export function resolveEnv() {
  const inCi = Boolean(process.env.CI) && Boolean(process.env.DATABASE_URL);
  const slot = !inCi && /^[1-9]$/.test(process.env.E2E_SLOT ?? '') ? process.env.E2E_SLOT : '';
  const suffix = slot ? `_${slot}` : '';
  const localUrl = slot ? `http://localhost:32${slot}0` : 'http://localhost:3200';
  const appUrl = process.env.E2E_APP_URL ?? (inCi ? (process.env.APP_URL ?? 'http://localhost:3000') : localUrl);
  const databaseUrl = inCi
    ? process.env.DATABASE_URL
    : (process.env.E2E_DATABASE_URL ?? `postgres://velocity:velocity@localhost:54320/velocity_e2e_web${suffix}`);
  const adminUrl = process.env.E2E_ADMIN_DATABASE_URL ?? 'postgres://velocity:velocity@localhost:54320/postgres';
  const dataDir = join(tmpdir(), `velocity-e2e-web${suffix}`);
  return {
    inCi,
    appUrl,
    port: Number(new URL(appUrl).port || 80),
    databaseUrl,
    adminUrl,
    dataDir,
    authFile: join(WEB_DIR, 'e2e', '.auth', `owner${suffix}.json`),
    outputDir: join(WEB_DIR, `test-results${suffix}`),
    appSecret: process.env.APP_SECRET ?? 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
  };
}

/** Env passed to the API server and the seed CLI. */
export function serverEnv(cfg = resolveEnv()) {
  return {
    ...process.env,
    DATABASE_URL: cfg.databaseUrl,
    APP_URL: cfg.appUrl,
    APP_SECRET: cfg.appSecret,
    PORT: String(cfg.port),
    WEB_DIST_DIR: join(WEB_DIR, 'dist'),
    UPLOAD_DIR: join(cfg.dataDir, 'uploads'),
    EXPORT_DIR: join(cfg.dataDir, 'exports'),
    BACKUP_DIR: join(cfg.dataDir, 'backups'),
    LOG_LEVEL: 'warn',
  };
}
