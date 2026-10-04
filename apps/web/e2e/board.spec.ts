// SPEC §4.11.1: Board layout toggle, drag-and-drop between status columns, keyboard move persistence.
import { expect, test, createIssueViaKeyboard, rowByTitle, uniqueTitle, pickFromPopup } from './support/fixtures';

test.describe('board layout', () => {
  test('toggle board layout with B key and navigate back to list', async ({ page }) => {
    const title = uniqueTitle('Board toggle');
    await page.goto('/team/ENG/backlog');
    await expect(page.getByTestId('view-header')).toBeVisible();
    await expect(page.getByTestId('issue-row').first()).toBeVisible();

    // Create an issue
    const row = await createIssueViaKeyboard(page, title);
    await expect(row).toBeVisible();

    // Press B to switch to board layout
    await page.keyboard.press('b');
    await expect(page).toHaveURL(/layout=board/);

    // Board cards should be visible
    const board = page.getByTestId('issue-board');
    await expect(board).toBeVisible();
    const card = page.getByTestId('board-card').filter({ hasText: title });
    await expect(card).toBeVisible();

    // Press B again to switch back to list layout
    await page.keyboard.press('b');
    await expect(page).not.toHaveURL(/layout=board/);

    // Should be back on list view
    await expect(board).not.toBeVisible();
    await expect(rowByTitle(page, title)).toBeVisible();
  });

  test('drag card to another status column and persist after reload', async ({ page }) => {
    const title = uniqueTitle('Board drag');
    await page.goto('/team/ENG/backlog');
    await expect(page.getByTestId('view-header')).toBeVisible();

    // Create an issue in Backlog status.
    const row = await createIssueViaKeyboard(page, title);
    await expect(row).toBeVisible();

    // Switch to board layout with status grouping
    await page.goto('/team/ENG/all?group=status&layout=board&done=all&order=manual');
    await expect(page.getByTestId('issue-board')).toBeVisible();

    // Find the card
    const card = page.getByTestId('board-card').filter({ hasText: title });
    await expect(card).toBeVisible();

    // The all-issues view includes both source and target status columns.
    const columns = page.getByTestId('board-column');
    const columnCount = await columns.count();
    expect(columnCount).toBeGreaterThan(1);
    const targetColumn = columns.nth(1);
    await card.dragTo(targetColumn);
    await expect(targetColumn.getByTestId('board-card').filter({ hasText: title })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/layout=board/);
    await expect(targetColumn.getByTestId('board-card').filter({ hasText: title })).toBeVisible();
  });

  test('move card to Done status using keyboard picker and persist after reload', async ({ page }) => {
    const title = uniqueTitle('Board keyboard move');
    await page.goto('/team/ENG/backlog');
    await expect(page.getByTestId('view-header')).toBeVisible();

    // Create an issue in Backlog status.
    const row = await createIssueViaKeyboard(page, title);
    await expect(row).toBeVisible();

    // Switch to board layout with status grouping
    await page.goto('/team/ENG/all?group=status&layout=board&done=all&order=manual');
    await expect(page.getByTestId('issue-board')).toBeVisible();

    // Find and focus the card
    const card = page.getByTestId('board-card').filter({ hasText: title });
    await expect(card).toBeVisible();
    await card.focus();
    await expect(card).toBeFocused();

    // Press M to open the status column picker
    await page.keyboard.press('m');

    // Wait for the picker to open, then use the helper
    const statusPicker = page.getByRole('combobox', { name: /status/i });
    await expect(statusPicker).toBeVisible({ timeout: 3000 });
    await pickFromPopup(page, 'Status', 'done');

    // Wait for the update
    await page.waitForTimeout(500);

    // Card should now be in the Done column
    const doneColumn = page.getByTestId('board-column').filter({ hasText: 'Done' });
    const movedCard = doneColumn.getByTestId('board-card').filter({ hasText: title });
    await expect(movedCard).toBeVisible();

    // Reload and verify the card is still in Done status
    await page.reload();
    await expect(page).toHaveURL(/layout=board/);
    await expect(page.getByTestId('issue-board')).toBeVisible();

    // Verify card is still in Done column
    const reloadedDoneColumn = page.getByTestId('board-column').filter({ hasText: 'Done' });
    const reloadedCard = reloadedDoneColumn.getByTestId('board-card').filter({ hasText: title });
    await expect(reloadedCard).toBeVisible();
  });
});
