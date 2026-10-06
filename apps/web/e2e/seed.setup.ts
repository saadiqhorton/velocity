// Seeds teams WEB/OPS, members, projects, cycles and 400 issues on top of the wizard's workspace.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, request, test as seed } from '@playwright/test';
import { SERVER_DIR, resolveEnv, serverEnv } from './support/env.mjs';

seed('seed demo data', async () => {
  seed.setTimeout(180_000);
  const cfg = resolveEnv();
  const res = spawnSync(process.execPath, ['--import', 'tsx', join(SERVER_DIR, 'src', 'seed-cli.ts'), '--issues', '400', '--deterministic'], {
    cwd: SERVER_DIR,
    env: serverEnv(cfg),
    encoding: 'utf8',
  });
  expect(res.status, `seed-cli failed:\n${res.stdout}\n${res.stderr}`).toBe(0);
});

// New workspaces start in Solo mode (S1, migration 0004). The suite exercises the whole
// product, so turn every feature on; `issue-page.spec.ts` covers Solo mode and restores this.
seed('turn on every workspace feature', async () => {
  const cfg = resolveEnv();
  const api = await request.newContext({ baseURL: cfg.appUrl, storageState: cfg.authFile, extraHTTPHeaders: { origin: cfg.appUrl } });
  const csrf = (await api.storageState()).cookies.find((c) => c.name === 'vel_csrf')?.value ?? '';
  const res = await api.post('/graphql', {
    headers: { 'x-csrf-token': csrf },
    data: { query: 'mutation { updateWorkspaceFeatures(input: { cycles: true, estimates: true, insights: true, members: true }) { features { solo } } }' },
  });
  const body = (await res.json()) as { data?: { updateWorkspaceFeatures?: { features: { solo: boolean } } }; errors?: unknown };
  expect(body.errors).toBeUndefined();
  expect(body.data?.updateWorkspaceFeatures?.features.solo).toBe(false);
  await api.dispose();
});
