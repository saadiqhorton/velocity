import { expect, test, uniqueTitle, rowByTitle, pickFromPopup } from './support/fixtures';

const PANEL = (page: import('@playwright/test').Page) => page.getByTestId('detail-panel');

test.describe('realtime', () => {
  test('newly created issue appears in real-time on other session', async ({ page, newSession }) => {
    const title = uniqueTitle('Realtime create');

    // Both sessions open the same backlog.
    const { page: pageB } = await newSession();
    await page.goto('/team/ENG/backlog');
    await pageB.goto('/team/ENG/backlog');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    await expect(pageB.getByTestId('issue-row').first()).toBeVisible();

    // Page A creates a new issue via the keyboard.
    await page.keyboard.press('c');
    const modal = page.getByTestId('create-issue-modal');
    await expect(modal).toBeVisible();
    await page.getByTestId('create-issue-title').fill(title);
    await page.getByTestId('create-issue-submit').click();
    await expect(modal).toBeHidden();
    const rowA = rowByTitle(page, title);
    await expect(rowA).toBeVisible();

    // Within 10s, the issue appears in page B without a reload.
    const rowB = rowByTitle(pageB, title);
    await expect(rowB).toBeVisible({ timeout: 10000 });
    await expect(pageB).not.toHaveURL(/.*[?&].*=.*[^/]/); // still on backlog, not an issue detail
  });

  test('title and priority changes appear in real-time on other session', async ({ page, newSession }) => {
    const title = uniqueTitle('Realtime edit');
    const newTitle = `${title} updated`;

    // Both sessions open the same backlog.
    const { page: pageB } = await newSession();
    await page.goto('/team/ENG/backlog');
    await pageB.goto('/team/ENG/backlog');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    await expect(pageB.getByTestId('issue-row').first()).toBeVisible();

    // Create issue in A.
    await page.keyboard.press('c');
    const modal = page.getByTestId('create-issue-modal');
    await expect(modal).toBeVisible();
    await page.getByTestId('create-issue-title').fill(title);
    await page.getByTestId('create-issue-submit').click();
    await expect(modal).toBeHidden();
    const rowA = rowByTitle(page, title);
    await expect(rowA).toBeVisible();

    // Issue appears in B.
    const rowB = rowByTitle(pageB, title);
    await expect(rowB).toBeVisible({ timeout: 10000 });

    // A focuses the row and opens the issue detail panel.
    await rowA.focus();
    await page.keyboard.press('Enter');
    const panel = PANEL(page);
    await expect(panel).toBeVisible();

    // A changes the title inline (autosaves after 500ms).
    const titleBox = page.getByTestId('issue-title');
    await titleBox.click();
    await titleBox.press('End');
    const saved = page.waitForResponse((r) => r.url().endsWith('/graphql') && (r.request().postData() ?? '').includes('"title"') && (r.request().postData() ?? '').includes(newTitle));
    await page.keyboard.type(' updated');
    await saved;

    // Within 10s, B's row shows the new title.
    const updatedRowB = rowByTitle(pageB, newTitle);
    await expect(updatedRowB).toBeVisible({ timeout: 10000 });

    // Return focus to the row by pressing Escape to blur the title input.
    await page.keyboard.press('Escape');

    // A changes priority to Urgent with P.
    await page.keyboard.press('p');
    await pickFromPopup(page, 'Priority', 'urgent');
    await expect(panel.getByRole('button', { name: 'Priority: Urgent' })).toBeVisible();

    // Within 10s, B's row shows the new priority.
    await expect(updatedRowB.getByRole('img', { name: 'Urgent' })).toBeVisible({ timeout: 10000 });
  });
});
