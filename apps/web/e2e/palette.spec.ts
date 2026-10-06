// SPEC §4.13: Ctrl/Cmd+K palette, fuzzy actions, `>` `#` `@` modes, Esc returns focus.
import { expect, test } from './support/fixtures';

test.describe('command palette', () => {
  const open = async (page: import('@playwright/test').Page) => {
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    await expect(input(page)).toBeFocused();
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/team/ENG/backlog');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
  });

  const palette = (page: import('@playwright/test').Page) => page.getByTestId('command-palette');
  const input = (page: import('@playwright/test').Page) => palette(page).getByRole('combobox');

  test('opens with Ctrl+K and runs a fuzzy-matched action', async ({ page }) => {
    await open(page);
    await input(page).fill('crt issu');
    await expect(palette(page).getByRole('option', { name: /Create issue/i }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect(page.getByTestId('create-issue-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('create-issue-modal')).toBeHidden();
  });

  test('> command mode lists commands and switches the theme', async ({ page }) => {
    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');
    await open(page);
    await page.keyboard.type('>');
    await expect(input(page)).toHaveAttribute('placeholder', /command/i);
    await page.keyboard.type('switch theme');
    await expect(palette(page).getByRole('option').first()).toHaveText('Switch theme');
    await page.keyboard.press('Enter');
    await expect(html).not.toHaveAttribute('data-theme', before ?? '');
    // Restore so later specs start from the same theme.
    await open(page);
    await page.keyboard.type('>switch theme');
    await page.keyboard.press('Enter');
    await expect(html).toHaveAttribute('data-theme', before ?? 'dark');
  });

  test('# jumps to an issue by ID', async ({ page }) => {
    await open(page);
    await page.keyboard.type('#ENG-1');
    const option = palette(page).getByRole('option', { name: /^ENG-1\s/ });
    await expect(option).toBeVisible();
    await option.click();
    await expect(palette(page)).toBeHidden();
    // The palette opens the full issue page (U1).
    await expect(page).toHaveURL(/\/issue\/ENG-1$/);
    await expect(page.getByTestId('issue-identifier')).toHaveText('ENG-1');
  });

  test('@ member mode finds people and opens their issues', async ({ page }) => {
    await open(page);
    await page.keyboard.type('@alex');
    const option = palette(page).getByRole('option', { name: /Alex/ });
    await expect(option).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/issues\?.*filter=.*alex/);
  });

  test('Tab moves between groups and Esc closes with focus back on the row', async ({ page }) => {
    await page.keyboard.press('j');
    const focused = page.locator('[data-issue-row]:focus');
    await expect(focused).toHaveCount(1);
    const label = await focused.getAttribute('aria-label');
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    const active = () => input(page).getAttribute('aria-activedescendant');
    const first = await active();
    await page.keyboard.press('Tab');
    expect(await active()).not.toBe(first);
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(page.locator('[data-issue-row]:focus')).toHaveAttribute('aria-label', label ?? '');
    // Ctrl+K toggles.
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeHidden();
  });
});
