// Visual snapshots (WP9). Chromium only; the design owner generates and approves the baselines
// (HANDOFF §0). Until baselines exist this spec skips, so it never fails CI (and a normal run never
// writes unapproved baselines). Font rendering differs between hosts, so the baselines are captured
// and checked only inside the Playwright image (CI job `visual`, tag `@visual`):
//   apps/web/scripts/visual-docker.sh <slot> --update      # regenerate (design owner)
//   apps/web/scripts/visual-docker.sh <slot>               # compare
// Host runs skip this spec with `--grep-invert @visual`.
//
// The `0-` prefix is load-bearing: Playwright runs files in name order (one worker), so this spec
// runs straight after setup + seed and the shell baseline sees only the deterministic seed. Every
// later spec adds issues and teams with random names (`uniqueTitle`) to the shared database.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './support/fixtures';

const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '0-visual.spec.ts-snapshots');

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

/**
 * Masks what drifts with the clock: relative times ("2h ago") and absolute dates, which follow the
 * run date because the seed anchors its timestamps to it (dated elements carry the full date as a
 * title). Covers this year and last, since seeded issues go back 120 days.
 */
async function maskTimes(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator[]> {
  const year = new Date().getUTCFullYear();
  return page.locator(`time, [title*="${year}"], [title*="${year - 1}"]`).all();
}

/**
 * A tall `fullPage` capture in the Playwright image can measure a few pixels short on the first
 * attempt (the scroll-and-stitch path settles after one pass), which fails Playwright's
 * two-consecutive-screenshot stability check even though the page itself never moves. Wait for the
 * self-hosted font and then take warm-up screenshots until the captured height stops changing.
 */
async function settleFullPage(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  let previous = -1;
  for (let attempt = 0; attempt < 5; attempt++) {
    const height = (await page.screenshot({ fullPage: true })).readUInt32BE(20);
    if (height === previous) return;
    previous = height;
    await page.waitForTimeout(100);
  }
}

// The shell baseline compares real content: the E2E seed runs `seed-cli --deterministic` (fixed RNG,
// timestamps anchored to the run date) and this spec runs before any other (see the file name).
// Only what still drifts is masked: relative times and dates.

test.describe('visual snapshots', { tag: '@visual' }, () => {
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
        await settleFullPage(page);
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
