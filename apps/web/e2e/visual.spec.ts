// Lane F — visual snapshots (WP9). Chromium only; baselines are generated and approved by the
// design owner after the design pass. Until baselines exist this spec skips, so it never fails CI
// (and a normal run never writes unapproved baselines). Generate them explicitly with
//   npx playwright test visual --project=chromium --update-snapshots      (or VISUAL_UPDATE=1)
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './support/fixtures';

const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'visual.spec.ts-snapshots');

function hasBaselines(): boolean {
  try {
    return existsSync(SNAPSHOT_DIR) && readdirSync(SNAPSHOT_DIR).some((f) => f.endsWith('.png'));
  } catch {
    return false;
  }
}

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 768 },
] as const;
const THEMES = ['dark', 'light'] as const;

/** Masks relative timestamps ("2h ago", "just now") that drift between runs. */
async function maskTimes(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator[]> {
  return page.locator('time, [title*="2026"]').all();
}

test.describe('visual snapshots', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Baselines are Chromium-only');
  // eslint-disable-next-line no-empty-pattern -- Playwright hooks must destructure their (empty) fixtures.
  test.beforeEach(({}, testInfo) => {
    // Playwright's default `updateSnapshots` is 'missing', which would silently write baselines;
    // only an explicit `--update-snapshots` ('changed'/'all') or VISUAL_UPDATE=1 may create them.
    const updateRequested = ['all', 'changed'].includes(testInfo.config.updateSnapshots) || process.env.VISUAL_UPDATE === '1';
    test.skip(!hasBaselines() && !updateRequested, 'No approved baselines yet — the design owner generates them after the design pass.');
  });

  for (const theme of THEMES) {
    for (const size of SIZES) {
      test(`gallery — ${theme} @ ${size.name}`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto(`/__gallery?enable=1&theme=${theme}`);
        await expect(page.locator('[data-theme-name]')).toHaveAttribute('data-theme-name', theme);
        await expect(page).toHaveScreenshot(`gallery-${theme}-${size.name}.png`, {
          fullPage: true,
          mask: await maskTimes(page),
        });
      });

      test(`shell — ${theme} @ ${size.name}`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/team/ENG/active?filter=&display=');
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await expect(page.getByTestId('issue-row').first()).toBeVisible();
        await expect(page).toHaveScreenshot(`shell-${theme}-${size.name}.png`, {
          fullPage: false,
          mask: await maskTimes(page),
        });
      });
    }
  }
});
