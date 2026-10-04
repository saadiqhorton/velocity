import { expect, test, uniqueTitle, rowByTitle, pickFromPopup, gotoTeam, createIssueViaKeyboard } from './support/fixtures';

test.describe('offline', () => {
  test('offline banner appears after 5s of disconnection and disappears after reconnection', async ({ page }) => {
    await page.goto('/team/ENG/backlog');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();

    // Banner should not be visible after ~3s of being offline (there's a 5s delay before showing).
    await page.context().setOffline(true);
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('offline-banner')).toBeHidden();

    // Banner should be visible within 8s.
    await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 8000 });

    // Reconnect.
    await page.context().setOffline(false);

    // Banner should disappear within 35s (backoff reconnection).
    await expect(page.getByTestId('offline-banner')).toBeHidden({ timeout: 35000 });
  });

  test('reconnecting refetches what changed while offline', async ({ page, newSession }) => {
    test.setTimeout(120_000);
    await gotoTeam(page, 'ENG', 'backlog');
    await page.context().setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 10_000 });

    // Another member's change lands while this tab is offline, so its realtime event is missed.
    const other = await newSession();
    await gotoTeam(other.page, 'ENG', 'backlog');
    const title = uniqueTitle('Made while offline');
    await createIssueViaKeyboard(other.page, title);
    await page.waitForTimeout(1000);
    await expect(rowByTitle(page, title)).toHaveCount(0);

    // On reconnect the client refetches active queries (lib/apollo.ts), without a reload.
    await page.context().setOffline(false);
    await expect(page.getByTestId('offline-banner')).toBeHidden({ timeout: 45_000 });
    await expect(rowByTitle(page, title)).toBeVisible({ timeout: 15_000 });
  });

  test('sync pulse appears during slow mutations', async ({ page }) => {
    await page.goto('/team/ENG/backlog');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();

    // Create an issue for this test.
    const title = uniqueTitle('Sync pulse');
    await page.keyboard.press('c');
    const modal = page.getByTestId('create-issue-modal');
    await expect(modal).toBeVisible();
    await page.getByTestId('create-issue-title').fill(title);
    await page.getByTestId('create-issue-submit').click();
    await expect(modal).toBeHidden();
    const row = rowByTitle(page, title);
    await expect(row).toBeVisible();

    // Delay UpdateIssue responses by 800ms.
    await page.route('**/graphql', async (route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('UpdateIssue')) {
        await new Promise((r) => setTimeout(r, 800));
      }
      await route.continue();
    });

    // Focus the row and change priority to Urgent (P).
    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press('p');
    await pickFromPopup(page, 'Priority', 'urgent');

    // The row should immediately show the new priority (optimistic update).
    await expect(row.getByRole('img', { name: 'Urgent' })).toBeVisible();

    // After ~800ms, the sync-pulse class should appear on the row.
    await expect(row).toHaveClass(/sync-pulse/, { timeout: 1000 });

    // The sync-pulse class should disappear shortly after (~200ms after the response).
    await expect(row).not.toHaveClass(/sync-pulse/, { timeout: 500 });
  });
});
