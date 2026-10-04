import { expect, graphqlAs, test } from './support/fixtures';

async function switchThemeFromPalette(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('Control+k');
  const palette = page.getByTestId('command-palette');
  const input = palette.getByRole('combobox');
  await expect(palette).toBeVisible();
  await input.fill('>switch theme');
  await expect(palette.getByRole('option', { name: 'Switch theme', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
}

test.describe('theme', () => {
  // Switching the theme saves an explicit preference on the shared owner's profile, which then
  // overrides the browser's color scheme for every later spec (and the other browser project).
  test.afterEach(async ({ page }) => {
    await graphqlAs(page, 'mutation { updateProfile(input: { theme: system }) { id } }');
  });

  test('account theme switch persists after reload', async ({ page }) => {
    await page.goto('/team/ENG/active');
    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');
    expect(before).toBeTruthy();

    await page.getByTestId('account-menu').click();
    await page.getByRole('menuitem', { name: /switch theme/i }).click();
    await expect(html).not.toHaveAttribute('data-theme', before ?? '');
    const flipped = await html.getAttribute('data-theme');

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', flipped ?? '');

    await page.getByTestId('account-menu').click();
    await page.getByRole('menuitem', { name: /switch theme/i }).click();
    await expect(html).toHaveAttribute('data-theme', before ?? '');
  });

  test('command palette switches the theme', async ({ page }) => {
    await page.goto('/team/ENG/active');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');

    await switchThemeFromPalette(page);
    await expect(html).not.toHaveAttribute('data-theme', before ?? '');

    await switchThemeFromPalette(page);
    await expect(html).toHaveAttribute('data-theme', before ?? '');
  });
});
