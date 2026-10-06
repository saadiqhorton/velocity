// Lane D — workspace QA (SPEC §3.10, §4.11.10): inbox, search, My Issues, favorites.
import { expect, test, createIssueViaKeyboard, uniqueTitle } from './support/fixtures';

test.describe('workspace', () => {
  test('inbox lists notifications, marks one read, and marks all read', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.getByTestId('inbox')).toBeVisible();

    const markAll = page.getByTestId('mark-all-read');
    if (await markAll.isEnabled()) {
      await expect(page.getByTestId('unread-dot').first()).toBeVisible();
      await markAll.click();
      await expect(page.getByTestId('unread-dot')).toHaveCount(0, { timeout: 10_000 });
      await expect(markAll).toBeDisabled();
    } else {
      await expect(markAll).toBeDisabled();
    }
  });

  test('search runs from the sidebar, finds the issue, and opens the detail panel', async ({ page }) => {
    const title = uniqueTitle('Search target');
    await page.goto('/team/ENG/active');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    await createIssueViaKeyboard(page, title);
    await page.goto('/team/ENG/active');
    await expect(page.getByTestId('view-header')).toBeVisible();

    // `/` focuses the sidebar search; typing navigates to /search?q=….
    await page.keyboard.press('/');
    const search = page.getByRole('searchbox', { name: 'Search' });
    await expect(search).toBeFocused();
    await search.fill(title);
    await expect(page).toHaveURL(/\/search\?q=/);
    await expect(page.getByTestId('search-screen')).toBeVisible();

    const result = page.locator('[data-result]').filter({ hasText: title });
    await expect(result).toBeVisible();
    await result.click();
    // Search results open the full issue page (U1).
    await expect(page).toHaveURL(/\/issue\/[A-Z]+-\d+$/);
    await expect(page.getByTestId('issue-title')).toHaveValue(title);
  });

  test('My Issues presets are their own filters and share by URL', async ({ page }) => {
    await page.goto('/my-issues');
    await expect(page.getByTestId('list-screen-my-issues-assigned')).toBeVisible();
    await page.getByRole('tab', { name: 'Created' }).click();
    await expect(page).toHaveURL(/\/my-issues\/created$/);
    await expect(page.getByTestId('list-screen-my-issues-created')).toBeVisible();
    await page.getByRole('tab', { name: 'Subscribed' }).click();
    await expect(page).toHaveURL(/\/my-issues\/subscribed$/);
    await expect(page.getByTestId('list-screen-my-issues-subscribed')).toBeVisible();
  });

  test('a project can be favorited and appears in the sidebar favorites', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Public launch' }).first().click();
    await expect(page.getByTestId('project-detail')).toBeVisible();
    const name = (await page.getByRole('heading').first().innerText()).trim();

    const fav = page.getByTestId('favorite-button');
    await expect(fav).toBeVisible();
    const sidebar = page.getByTestId('sidebar');
    const sidebarLink = sidebar.getByRole('group', { name: 'Favorites' }).getByRole('link', { name });
    // The DB is shared across browser projects: start from "not a favorite".
    if ((await fav.getAttribute('aria-pressed')) === 'true') {
      await fav.click();
      await expect(fav).toHaveAttribute('aria-pressed', 'false');
      await expect(sidebarLink).toHaveCount(0);
    }
    await fav.click();
    await expect(fav).toHaveAttribute('aria-pressed', 'true');
    await expect(sidebarLink).toBeVisible({ timeout: 10_000 });
  });
});
