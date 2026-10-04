// Playwright webServer command: (re)creates the E2E database locally, then runs the API
// serving the built SPA (apps/web/dist) so E2E exercises the production CSP.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { REPO_DIR, SERVER_DIR, WEB_DIR, resolveEnv, serverEnv } from './env.mjs';

const cfg = resolveEnv();

if (!existsSync(join(WEB_DIR, 'dist', 'index.html'))) {
  console.error('apps/web/dist/index.html is missing: run `pnpm --filter @velocity/web build` first.');
  process.exit(1);
}

if (!cfg.inCi) {
  // Local runs own a dedicated database; never touch any other.
  const dbName = new URL(cfg.databaseUrl).pathname.slice(1);
  if (!/^velocity_e2e_[a-z0-9_]+$/.test(dbName)) {
    console.error(`Refusing to recreate database "${dbName}": E2E databases must be named velocity_e2e_*.`);
    process.exit(1);
  }
  const require = createRequire(join(SERVER_DIR, 'package.json'));
  const pg = require('pg');
  const admin = new pg.Client({ connectionString: cfg.adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.query(`create database ${dbName}`);
  await admin.end();
}

rmSync(cfg.dataDir, { recursive: true, force: true });
for (const d of ['uploads', 'exports', 'backups']) mkdirSync(join(cfg.dataDir, d), { recursive: true });

// CI builds the server bundle right before E2E; locally the bundle may be stale, so run the source.
const bundle = join(SERVER_DIR, 'dist', 'main.js');
const useBundle = existsSync(bundle) && (cfg.inCi || process.env.E2E_USE_BUNDLE === '1');
const args = useBundle ? [bundle] : ['--import', 'tsx', join(SERVER_DIR, 'src', 'main.ts')];
const child = spawn(process.execPath, args, { cwd: SERVER_DIR, env: serverEnv(cfg), stdio: 'inherit' });
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
void REPO_DIR;
