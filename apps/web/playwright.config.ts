/**
 * Browser E2E (WP9, SPEC §7.3). Playwright boots the real API serving the built SPA
 * (`apps/web/dist`) under its production CSP; there is no Vite dev server involved.
 *
 * Run locally (Postgres on :54320 must be up; the config drops and recreates the
 * `velocity_e2e_web` database on every run and serves on http://localhost:3200):
 *   pnpm --filter @velocity/web build          # the API serves dist; rebuild after app changes
 *   cd apps/web
 *   npx playwright test --project=chromium     # setup (wizard) + seed + all specs
 *   npx playwright test --project=webkit
 *   npx playwright test visual --project=chromium --update-snapshots   # regenerate baselines
 *   npx playwright test keyboard-loop --project=chromium --headed      # debug one spec
 *   E2E_SLOT=3 npx playwright test bulk --project=chromium            # isolated parallel run (port 3230, db velocity_e2e_web_3)
 *
 * CI (`.github/workflows/ci.yml` job `e2e`): set CI=1 with DATABASE_URL, APP_URL
 * (http://localhost:3000) and APP_SECRET; the Postgres service database must be empty.
 *
 * Project flow: `setup` (first-run wizard through the UI, saves e2e/.auth/owner.json)
 * -> `seed` (apps/server seed-cli, 400 issues, teams WEB/OPS, members, projects)
 * -> `chromium` / `webkit` specs, all signed in through the saved storage state
 * (the auth endpoints are rate limited to 10 logins a minute, so specs never log in).
 * Visual baselines live in e2e/0-visual.spec.ts-snapshots/ (Chromium only). The spec's `0-` prefix
 * makes it the first file to run, so the shell baseline sees only the deterministic seed.
 */
import { defineConfig, devices } from '@playwright/test';
import { resolveEnv } from './e2e/support/env.mjs';

const env = resolveEnv();
const AUTH = env.authFile;

export default defineConfig({
  testDir: './e2e',
  outputDir: env.outputDir,
  timeout: 60_000,
  expect: { timeout: 8_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' } },
  fullyParallel: false,
  workers: env.inCi ? 1 : 1,
  forbidOnly: env.inCi,
  retries: env.inCi ? 1 : 0,
  reporter: env.inCi ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: env.appUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  webServer: {
    command: 'node e2e/support/server.mjs',
    url: `${env.appUrl}/healthz`,
    reuseExistingServer: Boolean(process.env.E2E_REUSE_SERVER), // dev loop: start e2e/support/server.mjs yourself, then run with --no-deps
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    { name: 'setup', testMatch: /wizard\.setup\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'seed', testMatch: /seed\.setup\.ts/, dependencies: ['setup'] },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['seed'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: AUTH },
    },
    {
      name: 'webkit',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['seed'],
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, storageState: AUTH },
    },
  ],
});
