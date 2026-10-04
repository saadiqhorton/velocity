// Lane D — planning + workspace QA (SPEC §3.8, §3.9, §4.11.4–7, §4.11.10, §4.12).
import { expect, test, uniqueTitle } from './support/fixtures';

test.describe('planning', () => {
  test('projects: create, edit name, add a milestone, and reorder it', async ({ page }) => {
    const name = uniqueTitle('E2E project');
    await page.goto('/projects');
    await expect(page.getByTestId('projects-list')).toBeVisible();

    await page.getByTestId('new-project').click();
    const modal = page.getByRole('dialog', { name: 'Create project' });
    await expect(modal).toBeVisible();
    await modal.getByTestId('project-name').fill(name);
    await modal.getByTestId('create-project-submit').click();
    await expect(page.getByTestId('project-detail')).toBeVisible();
    await expect(page.getByRole('heading', { name })).toBeVisible();

    // Inline rename on the overview tab.
    const renamed = `${name} renamed`;
    await page.getByTestId('project-name-input').fill(renamed);
    await page.getByTestId('project-name-input').blur();
    await expect(page.getByRole('heading', { name: renamed })).toBeVisible();

    // Milestones: add two, then reorder via the row menu.
    await page.getByRole('tab', { name: 'Milestones' }).click();
    await expect(page.getByTestId('project-milestones')).toBeVisible();
    const first = uniqueTitle('M1');
    const second = uniqueTitle('M2');
    for (const m of [first, second]) {
      await page.getByTestId('add-milestone').click();
      await page.getByTestId('new-milestone-name').fill(m);
      await page.getByTestId('new-milestone-name').press('Enter');
      await expect(page.getByTestId('milestone-list')).toContainText(m);
    }
    await expect(page.getByTestId('milestone-row').first()).toContainText(first);
    await page.getByRole('button', { name: `Actions for ${second}` }).click();
    await page.getByRole('menuitem', { name: 'Move up' }).click();
    await expect(page.getByTestId('milestone-row').first()).toContainText(second);
  });

  test('cycles: header stats, added-after-start marker, and close dialog can be canceled', async ({ page }) => {
    await page.goto('/team/ENG/cycles');
    await expect(page.getByTestId('cycle-header')).toBeVisible();
    await expect(page.getByTestId('cycle-stats')).toBeVisible();
    await expect(page.getByTestId('close-cycle')).toBeVisible();

    // Create an issue while the current cycle is selected: it is scoped to the cycle and, being
    // added after the cycle start, gets the per-row "added after start" marker (SPEC §3.8).
    const title = uniqueTitle('In-cycle');
    await page.keyboard.press('c');
    const modal = page.getByTestId('create-issue-modal');
    await expect(modal).toBeVisible();
    await page.getByTestId('create-issue-title').fill(title);
    await page.getByTestId('create-issue-submit').click();
    await expect(modal).toBeHidden();

    // Reload so the cycle query recomputes the added-after-start set.
    await page.reload();
    await expect(page.getByTestId('cycle-header')).toBeVisible();
    const row = page.getByTestId('issue-row').filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('added-after-start-marker')).toBeVisible();

    // The header scope summary counts it too.
    await expect(page.getByTestId('added-after-start')).toContainText(/added after start/);

    // Close-early dialog opens and cancels without touching the seeded cycle.
    await page.getByTestId('close-cycle').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('cycle-header')).toBeVisible();
  });

  test('insights charts link through to their live views', async ({ page }) => {
    await page.goto('/insights');
    await expect(page.getByTestId('insights-created-completed')).toBeVisible();
    await page.getByTestId('insights-open-created').click();
    await expect(page).toHaveURL(/\/issues\?filter=/);
    await expect(page.getByTestId('filter-chip')).toBeVisible();
  });

  test('V opens the issue action menu and moves the issue to another team', async ({ page }) => {
    const title = uniqueTitle('V move');
    await page.goto('/team/WEB/backlog');
    const first = page.getByTestId('issue-row').first();
    await expect(first).toBeVisible();

    // Create an issue in WEB via the C shortcut.
    await page.keyboard.press('c');
    const modal = page.getByTestId('create-issue-modal');
    await expect(modal).toBeVisible();
    await page.getByTestId('create-issue-title').fill(title);
    await page.getByTestId('create-issue-submit').click();
    await expect(modal).toBeHidden();
    const row = page.getByTestId('issue-row').filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.click();
    await expect(row).toBeFocused();

    const before = (await row.locator('.identifier').innerText()).trim();
    expect(before.startsWith('WEB-')).toBe(true);

    // V opens the context menu with the move submenu.
    await page.keyboard.press('v');
    const menu = page.getByRole('menu', { name: 'Issue actions' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Move issue' }).hover();
    const submenu = page.getByRole('menu', { name: 'Move issue' });
    await expect(submenu).toBeVisible();
    await submenu.getByRole('menuitem', { name: 'Engineering' }).click();

    // The move is optimistic (identifier becomes ENG-…), then the list refetches without the row.
    // Assert it landed in ENG's backlog rather than staying in WEB.
    const engRow = page.getByTestId('issue-row').filter({ hasText: title });
    await expect(engRow).toBeHidden({ timeout: 10_000 });
    await page.goto('/team/ENG/backlog');
    const moved = page.getByTestId('issue-row').filter({ hasText: title });
    await expect(moved).toBeVisible({ timeout: 10_000 });
    await expect(moved.locator('.identifier')).toHaveText(/^ENG-/);
  });
});
