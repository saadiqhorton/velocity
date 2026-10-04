// Seeds teams WEB/OPS, members, projects, cycles and 400 issues on top of the wizard's workspace.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test as seed } from '@playwright/test';
import { SERVER_DIR, resolveEnv, serverEnv } from './support/env.mjs';

seed('seed demo data', async () => {
  seed.setTimeout(180_000);
  const cfg = resolveEnv();
  const res = spawnSync(process.execPath, ['--import', 'tsx', join(SERVER_DIR, 'src', 'seed-cli.ts'), '--issues', '400'], {
    cwd: SERVER_DIR,
    env: serverEnv(cfg),
    encoding: 'utf8',
  });
  expect(res.status, `seed-cli failed:\n${res.stdout}\n${res.stderr}`).toBe(0);
});
