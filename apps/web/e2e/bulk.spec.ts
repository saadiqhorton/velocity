import { expect, test, createIssueViaKeyboard, pickFromPopup, rowByTitle, uniqueTitle, gotoTeam } from './support/fixtures';

test.describe('bulk selection and actions', () => {
  test('select multiple issues with x and Shift+x, bulk relabel with l, selection persists and clears', async ({ page }) => {
    const title1 = uniqueTitle('Bulk label 1');
    const title2 = uniqueTitle('Bulk label 2');
    const title3 = uniqueTitle('Bulk label 3');

    // Setup: go to backlog and create 3 new issues
    // Note: created issues appear at the top in reverse order: title3, title2, title1
    await gotoTeam(page, 'ENG', 'backlog');
    const row1 = await createIssueViaKeyboard(page, title1);
    const row2 = await createIssueViaKeyboard(page, title2);
    const row3 = await createIssueViaKeyboard(page, title3);

    // Focus on the first visible row (row3) and select it with x
    await row3.click();
    await row3.focus();
    await expect(row3).toBeFocused();
    await page.keyboard.press('x');
    await expect(row3).toHaveAttribute('aria-selected', 'true');

    // Move down with j to row2, then Shift+x to extend selection
    await page.keyboard.press('j');
    await expect(row2).toBeFocused();
    await page.keyboard.press('Shift+X');
    await expect(row2).toHaveAttribute('aria-selected', 'true');

    // Move down with j to row1, then Shift+x to extend selection
    await page.keyboard.press('j');
    await expect(row1).toBeFocused();
    await page.keyboard.press('Shift+X');
    await expect(row1).toHaveAttribute('aria-selected', 'true');

    // Verify selection bar is visible and shows count 3
    const selectionBar = page.getByTestId('selection-bar');
    await expect(selectionBar).toBeVisible();
    await expect(selectionBar).toContainText('3');

    // Press l to open label picker and select "Performance"
    await page.keyboard.press('l');
    await pickFromPopup(page, 'Labels', 'Performance', { keepOpen: true });
    await page.keyboard.press('Escape');

    // Verify all 3 rows now show "Performance" label
    await expect(row1).toContainText('Performance');
    await expect(row2).toContainText('Performance');
    await expect(row3).toContainText('Performance');

    // Reload and verify labels persisted
    await page.reload();
    await gotoTeam(page, 'ENG', 'backlog');
    const reloadedRow1 = rowByTitle(page, title1);
    const reloadedRow2 = rowByTitle(page, title2);
    const reloadedRow3 = rowByTitle(page, title3);
    await expect(reloadedRow1).toContainText('Performance');
    await expect(reloadedRow2).toContainText('Performance');
    await expect(reloadedRow3).toContainText('Performance');

    // Focus one of the rows and verify selection bar is visible
    await reloadedRow1.click();
    await reloadedRow1.focus();
    // Press x to select it
    await page.keyboard.press('x');
    await expect(reloadedRow1).toHaveAttribute('aria-selected', 'true');
    const barAfterReload = page.getByTestId('selection-bar');
    await expect(barAfterReload).toBeVisible();

    // Escape closes the detail panel first, then clears the selection.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail-panel')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('selection-bar')).toBeHidden();
    await expect(reloadedRow1).toHaveAttribute('aria-selected', 'false');
  });

  test('select multiple issues and set priority via p shortcut, persist after reload', async ({ page }) => {
    const title1 = uniqueTitle('Bulk priority 1');
    const title2 = uniqueTitle('Bulk priority 2');

    // Setup: go to backlog and create 2 new issues
    // Note: created issues appear at the top in reverse order: title2, title1
    await gotoTeam(page, 'ENG', 'backlog');
    const row1 = await createIssueViaKeyboard(page, title1);
    const row2 = await createIssueViaKeyboard(page, title2);

    // Focus on the first visible row (row2) and select it with x
    await row2.click();
    await row2.focus();
    await page.keyboard.press('x');
    await expect(row2).toHaveAttribute('aria-selected', 'true');

    // Move down with j to row1 and extend selection with Shift+x
    await page.keyboard.press('j');
    await expect(row1).toBeFocused();
    await page.keyboard.press('Shift+X');
    await expect(row1).toHaveAttribute('aria-selected', 'true');
    await expect(row2).toHaveAttribute('aria-selected', 'true');

    // Verify selection bar is visible
    const selectionBar = page.getByTestId('selection-bar');
    await expect(selectionBar).toBeVisible();
    await expect(selectionBar).toContainText('2');

    // Press p to open priority picker and select "Urgent"
    await page.keyboard.press('p');
    await pickFromPopup(page, 'Priority', 'Urgent');

    // Verify priority changed on both rows
    // Priority is indicated by the aria-label on the PriorityIcon which contains "Urgent"
    await expect(row1.getByRole('img', { name: /Urgent/ })).toBeVisible();
    await expect(row2.getByRole('img', { name: /Urgent/ })).toBeVisible();

    // Reload and verify priority persisted
    await page.reload();
    await gotoTeam(page, 'ENG', 'backlog');
    const reloadedRow1 = rowByTitle(page, title1);
    const reloadedRow2 = rowByTitle(page, title2);
    await expect(reloadedRow1.getByRole('img', { name: /Urgent/ })).toBeVisible();
    await expect(reloadedRow2.getByRole('img', { name: /Urgent/ })).toBeVisible();
  });

  test('bulk bar edits status, assignee, project, and cycle with mouse and keyboard', async ({ page }) => {
    const first = uniqueTitle('Bulk properties A');
    const second = uniqueTitle('Bulk properties B');
    await page.goto('/team/ENG/all?group=none&order=updated&cols=priority,identifier,status,labels,project,cycle,assignee');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    const rowA = await createIssueViaKeyboard(page, first);
    const rowB = await createIssueViaKeyboard(page, second);
    await rowB.focus();
    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await expect(rowA).toBeFocused();
    await page.keyboard.press('Shift+X');

    const bar = page.getByTestId('selection-bar');
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Status' }).click();
    await pickFromPopup(page, 'Status', 'in progress');
    await expect(rowA.getByRole('img', { name: 'In Progress' })).toBeVisible();
    await expect(rowB.getByRole('img', { name: 'In Progress' })).toBeVisible();

    await bar.getByRole('button', { name: 'Assignee' }).focus();
    await page.keyboard.press('Enter');
    await pickFromPopup(page, 'Assignee', 'alex');
    await expect(rowA.getByRole('img', { name: 'Alex' })).toBeVisible();
    await expect(rowB.getByRole('img', { name: 'Alex' })).toBeVisible();

    await bar.getByRole('button', { name: 'Project' }).click();
    await pickFromPopup(page, 'Project', 'Billing v2');
    await expect(rowA).toContainText('Billing v2');
    await expect(rowB).toContainText('Billing v2');

    await bar.getByRole('button', { name: 'Cycle' }).focus();
    await page.keyboard.press('Enter');
    const cycleBox = page.getByRole('combobox', { name: 'Cycle' });
    await expect(cycleBox).toBeFocused();
    // The seed gives ENG a current and an upcoming cycle (seed-cli); assign the current one.
    await expect(page.getByRole('option', { name: 'No cycle' })).toBeVisible();
    const current = page.getByRole('option').filter({ hasText: 'Current' });
    await expect(current).toHaveCount(1);
    // The option shows the cycle name plus its status description; the panel shows the name.
    const cycleName = (await current.innerText()).split('\n')[0]!.trim();
    expect(cycleName).toMatch(/^Cycle \d+$/);
    await current.click();
    await expect(cycleBox).toBeHidden();

    await page.reload();
    await expect(rowByTitle(page, first)).toContainText('Billing v2');
    await expect(rowByTitle(page, second)).toContainText('Billing v2');
    await expect(rowByTitle(page, first).getByRole('img', { name: 'Alex' })).toBeVisible();
    await expect(rowByTitle(page, second).getByRole('img', { name: 'Alex' })).toBeVisible();
    const panel = page.getByTestId('detail-panel');
    for (const title of [first, second]) {
      await rowByTitle(page, title).focus();
      await page.keyboard.press('Enter');
      await expect(panel.getByTestId('issue-title')).toHaveValue(title);
      await expect(panel.getByTestId('prop-cycle')).toContainText(cycleName);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    }
  });

  test('bulk bar archives and deletes selected issues', async ({ page }) => {
    const first = uniqueTitle('Bulk dispose A');
    const second = uniqueTitle('Bulk dispose B');
    await gotoTeam(page, 'ENG', 'backlog');
    const rowA = await createIssueViaKeyboard(page, first);
    const rowB = await createIssueViaKeyboard(page, second);
    await rowB.focus();
    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await expect(rowA).toBeFocused();
    await page.keyboard.press('Shift+X');

    const bar = page.getByTestId('selection-bar');
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Archive' }).focus();
    await page.keyboard.press('Enter');
    await expect(rowByTitle(page, first)).toHaveCount(0);
    await expect(rowByTitle(page, second)).toHaveCount(0);
    const flag = page.getByRole('status').filter({ hasText: 'Issues archived' });
    await expect(flag).toBeVisible();
    await flag.getByRole('button', { name: 'Undo' }).click();
    await expect(rowByTitle(page, first)).toBeVisible();
    await expect(rowByTitle(page, second)).toBeVisible();

    await rowByTitle(page, second).focus();
    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await page.keyboard.press('Shift+X');
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(rowByTitle(page, first)).toHaveCount(0);
    await expect(rowByTitle(page, second)).toHaveCount(0);
    await page.reload();
    await expect(rowByTitle(page, first)).toHaveCount(0);
    await expect(rowByTitle(page, second)).toHaveCount(0);
  });
});
