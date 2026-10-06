// SPEC §4.12 (keyboard table) and §8.2 "keyboard-only completion": create, navigate, panel, edit, act.
import { expect, test, createIssueViaKeyboard, focusedLabel, hasPrimaryIndicator, pickFromPopup, rowByTitle, uniqueTitle } from './support/fixtures';

const PANEL = (page: import('@playwright/test').Page) => page.getByTestId('detail-panel');

test.describe('keyboard loop', () => {
  test('create, navigate, open panel, edit title with autosave, act on row and panel, Esc returns focus', async ({ page }) => {
    const title = uniqueTitle('Kbd loop');
    await page.goto('/team/ENG/backlog');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();

    // C opens the create modal; Enter submits; the new issue is at the top of the manual-ordered backlog.
    const row = await createIssueViaKeyboard(page, title);
    await expect(page.getByTestId('issue-row').first()).toContainText(title);

    // J/K and the arrow keys move the focus; the focused row is the roving tab stop with the left indicator.
    await page.keyboard.press('j');
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute('tabindex', '0');
    expect(await hasPrimaryIndicator(row)).toBe(true);
    await page.keyboard.press('ArrowDown');
    const second = page.getByTestId('issue-row').nth(1);
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute('tabindex', '0');
    await expect(row).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('k');
    await expect(row).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    // Retrying: focus moves after React commits the key handling (WebKit can be a frame behind).
    await expect.poll(() => focusedLabel(page)).toContain(title);

    // Space peeks the issue in the 400px panel (U1; Enter opens the full page).
    await page.keyboard.press(' ');
    const panel = PANEL(page);
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/[?&]issue=[0-9a-f-]{36}/);
    expect((await panel.boundingBox())?.width).toBeCloseTo(400, -1);
    await expect(page.getByTestId('issue-title')).toHaveValue(title);

    // Row-level shortcuts with the panel open (focus is on the row): priority, assign to me, label.
    await page.keyboard.press('p');
    await pickFromPopup(page, 'Priority', 'urgent');
    await expect(panel.getByRole('button', { name: 'Priority: Urgent' })).toBeVisible();
    await expect(row).toBeFocused();

    await page.keyboard.press('i');
    await expect(panel.getByRole('button', { name: /^Assignee: E2E Owner/ })).toBeVisible();

    await page.keyboard.press('a');
    await pickFromPopup(page, 'Assignee', 'alex');
    await expect(panel.getByRole('button', { name: /^Assignee: Alex/ })).toBeVisible();

    await page.keyboard.press('l');
    await pickFromPopup(page, 'Labels', 'bug', { keepOpen: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Labels' })).toBeHidden();
    await expect(panel.getByTestId('prop-labels')).toContainText('Bug');
    await expect(row).toBeFocused();

    // Panel-scoped shortcuts: focus a control inside the panel, then use the same keys.
    await page.getByTestId('issue-identifier').focus();
    await page.keyboard.press('p');
    await pickFromPopup(page, 'Priority', 'high');
    await expect(panel.getByRole('button', { name: 'Priority: High' })).toBeVisible();
    await expect(page.getByTestId('issue-identifier')).toBeFocused();
    await page.keyboard.press('i');
    await expect(panel.getByRole('button', { name: /^Assignee: E2E Owner/ })).toBeVisible();

    // Inline title edit autosaves 500ms after the last keystroke and survives a reload.
    const edited = `${title} edited`;
    const titleBox = page.getByTestId('issue-title');
    await titleBox.click();
    await titleBox.press('End');
    const saved = page.waitForResponse((r) => r.url().endsWith('/graphql') && (r.request().postData() ?? '').includes('"title"') && (r.request().postData() ?? '').includes(edited));
    const typedAt = Date.now();
    await page.keyboard.type(' edited');
    await saved;
    expect(Date.now() - typedAt, 'debounced, not per keystroke').toBeGreaterThanOrEqual(450);
    await page.reload();
    await expect(rowByTitle(page, edited)).toBeVisible();
    await expect(page.getByTestId('issue-title')).toHaveValue(edited);

    // Esc (from outside a text field) closes the panel and focus returns to the same row.
    await page.getByTestId('issue-identifier').focus();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page).not.toHaveURL(/issue=/);
    const returned = rowByTitle(page, edited);
    await expect(returned).toBeFocused();
    await expect(returned).toHaveAttribute('tabindex', '0');
  });

  test('status, done, archive with undo, relation and full page on the focused row', async ({ page }) => {
    const title = uniqueTitle('Kbd actions');
    await page.goto('/team/ENG/all?group=none&order=updated');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    await createIssueViaKeyboard(page, title);
    const row = rowByTitle(page, title);
    await row.focus();
    await expect(row).toBeFocused();

    await page.keyboard.press('s');
    await pickFromPopup(page, 'Status', 'in progress');
    await expect(row.getByRole('img', { name: 'In Progress' })).toBeVisible();
    await expect(row).toBeFocused();

    // E marks done; the same key toggles back (SPEC §4.12).
    await page.keyboard.press('e');
    await expect(row.getByRole('img', { name: 'Done' })).toBeVisible();

    // R adds a relation to another issue.
    await page.keyboard.press('r');
    const dialog = page.getByRole('dialog', { name: 'Add relation' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Search' }).fill('ENG-2');
    await expect(dialog.getByRole('listbox').getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();

    // Y archives with an undo flag; undo restores the row.
    await page.keyboard.press('y');
    await expect(rowByTitle(page, title)).toHaveCount(0);
    const flag = page.getByRole('status').filter({ hasText: 'Issue archived' });
    await expect(flag).toBeVisible();
    await flag.getByRole('button', { name: 'Undo' }).click();
    await expect(rowByTitle(page, title)).toBeVisible();

    // Ctrl/Cmd+Enter opens the full page /issue/ENG-n with the relation listed.
    await rowByTitle(page, title).focus();
    await page.keyboard.press('Control+Enter');
    await expect(page).toHaveURL(/\/issue\/ENG-\d+$/);
    await expect(page.getByTestId('issue-title')).toHaveValue(title);
    await expect(page.getByTestId('relations')).toContainText('ENG-2');
  });

  test('move to team (M) and delete with confirmation (#)', async ({ page }) => {
    const moveTitle = uniqueTitle('Kbd move');
    const deleteTitle = uniqueTitle('Kbd delete');
    await page.goto('/team/ENG/backlog');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    await createIssueViaKeyboard(page, deleteTitle);
    await createIssueViaKeyboard(page, moveTitle);

    const del = rowByTitle(page, deleteTitle);
    await del.focus();
    await page.keyboard.press('#');
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /delete/i }));
    await expect(confirm).toBeVisible();
    await page.keyboard.press('Escape'); // cancel keeps the issue
    await expect(confirm).toBeHidden();
    await expect(del).toBeVisible();
    await page.keyboard.press('#');
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(rowByTitle(page, deleteTitle)).toHaveCount(0);

    const mv = rowByTitle(page, moveTitle);
    await mv.focus();
    await page.keyboard.press('m');
    await pickFromPopup(page, 'Move to team', 'web');
    await expect(rowByTitle(page, moveTitle)).toHaveCount(0);
    await page.goto('/team/WEB/backlog');
    await expect(rowByTitle(page, moveTitle)).toBeVisible();
    await expect(rowByTitle(page, moveTitle)).toContainText('WEB-');
  });

  test('G chords, ? help and / search focus', async ({ page }) => {
    await page.goto('/team/ENG/active');
    await expect(page.getByTestId('view-header')).toBeVisible();
    const chords: [string, RegExp][] = [
      ['g i', /\/inbox$/],
      ['g m', /\/my-issues$/],
      ['g b', /\/team\/ENG\/backlog$/],
      ['g t', /\/team\/ENG\/cycles$/],
      ['g p', /\/projects$/],
      ['g s', /\/settings(\/.*)?$/],
      ['g a', /\/issues$/],
    ];
    for (const [keys, url] of chords) {
      for (const k of keys.split(' ')) await page.keyboard.press(k);
      await expect(page, `chord ${keys}`).toHaveURL(url);
    }

    // ? opens the searchable shortcut help; Esc closes it.
    await page.goto('/issues');
    await expect(page.getByTestId('view-header')).toBeVisible();
    await page.keyboard.press('?');
    const help = page.getByTestId('shortcuts-help');
    await expect(help).toBeVisible();
    await expect(help.getByRole('searchbox')).toBeFocused();
    await page.keyboard.type('archive');
    await expect(help).toContainText('Archive');
    await expect(help).not.toContainText('Toggle selection');
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    // / focuses the sidebar search.
    await page.keyboard.press('/');
    await expect(page.locator('#sidebar-search')).toBeFocused();
  });
});
