import { expect, test, uniqueTitle, gotoTeam, rowByTitle, createIssueViaKeyboard } from './support/fixtures';

const PANEL = (page: import('@playwright/test').Page) => page.getByTestId('detail-panel');

test.describe('issue detail panel', () => {
  test('deep link and back/forward navigation', async ({ page, guard, newSession }) => {
    const title = uniqueTitle('Deep link');
    // Use backlog view since that's where new issues appear
    await gotoTeam(page, 'ENG', 'backlog');

    // Create an issue and peek it in the panel with Space (U1: Enter opens the full page)
    const row = await createIssueViaKeyboard(page, title);
    await row.focus();
    await page.keyboard.press(' ');
    const panel = PANEL(page);
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/[?&]issue=[0-9a-f-]{36}/);

    // Copy the URL with the issue parameter
    const urlWithIssue = page.url();
    const issueId = new URL(urlWithIssue).searchParams.get('issue');
    expect(issueId).toBeTruthy();

    // Open the URL in a new session
    const { page: page2 } = await newSession();
    await page2.goto(urlWithIssue);
    await expect(PANEL(page2)).toBeVisible();
    await expect(page2).toHaveURL(/[?&]issue=[0-9a-f-]{36}/);

    // In the first page, go back
    await page.goBack();
    await expect(panel).toBeHidden();
    await expect(page).not.toHaveURL(/issue=/);

    // Go forward
    await page.goForward();
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/[?&]issue=/);

    await page2.close();
    expect(guard.csp.length).toBe(0);
  });

  test('panel width at different viewports', async ({ page }) => {
    const title = uniqueTitle('Panel width');
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoTeam(page, 'ENG', 'backlog');
    const row = await createIssueViaKeyboard(page, title);
    await row.focus();
    await page.keyboard.press(' ');
    const panel = PANEL(page);
    await expect(panel).toBeVisible();

    // At 1440px viewport, panel width should be 400±2px
    let bbox = await panel.boundingBox();
    expect(bbox?.width).toBeCloseTo(400, -1); // toBeCloseTo with 1 digit tolerance = ±2

    // Change viewport to 1100×800
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect(panel).toBeVisible();

    // At 1100px viewport, panel width should be 360±2px
    bbox = await panel.boundingBox();
    expect(bbox?.width).toBeCloseTo(360, -1); // ±2 tolerance
  });

  test('markdown description with autosave under CSP', async ({ page, guard }) => {
    const title = uniqueTitle('Markdown desc');
    await gotoTeam(page, 'ENG', 'backlog');
    const row = await createIssueViaKeyboard(page, title);
    await row.focus();
    await page.keyboard.press(' ');
    const panel = PANEL(page);
    await expect(panel).toBeVisible();

    // Click the description area (placeholder "Add a description…")
    const descriptionArea = page.getByTestId('issue-description').locator('role=textbox');
    await descriptionArea.click();
    await expect(descriptionArea).toBeFocused();

    // Type "Hello " then "**bold**" text using keyboard (tiptap supports markdown shortcuts)
    await page.keyboard.type('Hello ');
    await page.keyboard.type('**bold**');

    // Add a new line with a list item
    await page.keyboard.press('Enter');
    await page.keyboard.type('- item one');

    // Blur by pressing Escape; the blur flush triggers the autosave (SPEC §4.11.3).
    const savePromise = page.waitForResponse(
      (r) => r.url().endsWith('/graphql') && (r.request().postData() ?? '').includes('UpdateIssueDescription')
    );
    await page.keyboard.press('Escape');
    await expect(descriptionArea).not.toBeFocused();

    // The 800ms debounce may also fire first; either way the save request must arrive.
    await savePromise;

    // Reload the page
    await page.reload();
    await expect(panel).toBeVisible();

    // Check that the description renders with <strong> for bold and list item
    const description = page.getByTestId('issue-description');
    await expect(description.locator('strong')).toContainText('bold');
    await expect(description.locator('li')).toContainText('item one');

    // Guard should have zero CSP violations
    expect(guard.csp.length).toBe(0);
  });

  test('full page view with Control+Enter', async ({ page }) => {
    const title = uniqueTitle('Full page');
    await gotoTeam(page, 'ENG', 'backlog');
    const row = await createIssueViaKeyboard(page, title);
    await row.focus();
    await expect(row).toBeFocused();

    // Press Control+Enter to open the full page
    await page.keyboard.press('Control+Enter');
    await expect(page).toHaveURL(/\/issue\/ENG-\d+$/);
    await expect(page.getByTestId('issue-title')).toHaveValue(title);

    // Pressing Escape should return to the list
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/team\/ENG\/backlog$/);
    await expect(page.getByTestId('view-header')).toBeVisible();

    // Open full page again using Control+Enter
    const rowAgain = rowByTitle(page, title);
    await rowAgain.focus();
    await page.keyboard.press('Control+Enter');
    await expect(page).toHaveURL(/\/issue\/ENG-\d+$/);

    // Go back to the list
    await page.goBack();
    await expect(page).toHaveURL(/\/team\/ENG\/backlog$/);
  });

  test('title, properties, subscription, and activity persist', async ({ page }) => {
    const title = uniqueTitle('Detail fields');
    await gotoTeam(page, 'ENG', 'backlog');
    const row = await createIssueViaKeyboard(page, title);
    await row.focus();
    await page.keyboard.press(' ');
    const panel = PANEL(page);
    await expect(panel).toBeVisible();

    const editedTitle = `${title} changed`;
    await panel.getByTestId('issue-title').fill(editedTitle);
    await expect(rowByTitle(page, editedTitle)).toBeVisible({ timeout: 5000 });
    await panel.getByTestId('prop-priority').click();
    await page.getByRole('option', { name: 'Urgent' }).click();
    await expect(panel.getByTestId('prop-priority')).toContainText('Urgent');
    await panel.getByTestId('prop-assignee').click();
    await page.getByRole('option', { name: /E2E Owner/ }).click();
    await expect(panel.getByTestId('prop-assignee')).not.toContainText('Unassigned');
    await panel.getByTestId('prop-estimate').click();
    await page.getByRole('option', { name: /2 points/ }).click();
    await expect(panel.getByTestId('prop-estimate')).toContainText('2');
    await panel.getByTestId('prop-labels').click();
    await page.getByRole('option', { name: /Bug/ }).click();
    await page.keyboard.press('Escape');
    await expect(panel.getByTestId('prop-labels')).toContainText('Bug');
    await panel.getByTestId('prop-project').click();
    const project = page.getByRole('option').nth(1);
    const projectName = (await project.innerText()).trim();
    await project.click();
    await expect(panel.getByTestId('prop-project')).toContainText(projectName);
    // The seed enables cycles on ENG (current + upcoming), so the cycle picker must be there.
    await expect(panel.getByTestId('prop-cycle')).toBeVisible();
    await panel.getByTestId('prop-cycle').click();
    const cycle = page.getByRole('option').nth(1);
    // The option shows the cycle name plus a status description; the property button shows the name.
    const cycleName = (await cycle.innerText()).split('\n')[0]!.trim();
    expect(cycleName).toMatch(/^Cycle \d+$/);
    await cycle.click();
    await expect(panel.getByTestId('prop-cycle')).toContainText(cycleName);
    await panel.getByTestId('prop-status').click();
    await page.getByRole('option', { name: 'Todo' }).click();
    await expect(panel.getByTestId('prop-status')).toContainText('Todo');

    const subscribe = panel.getByTestId('subscribe-toggle');
    const subscribedBefore = await subscribe.getAttribute('aria-pressed');
    const subscribedAfter = subscribedBefore === 'true' ? 'false' : 'true';
    await subscribe.click();
    await expect(subscribe).toHaveAttribute('aria-pressed', subscribedAfter);
    await panel.getByRole('tab', { name: 'Activity' }).click();
    await expect(panel.getByRole('tabpanel')).toBeVisible();
    await page.reload();
    await expect(panel.getByTestId('issue-title')).toHaveValue(editedTitle);
    await expect(panel.getByTestId('prop-priority')).toContainText('Urgent');
    await expect(panel.getByTestId('prop-estimate')).toContainText('2');
    await expect(panel.getByTestId('prop-labels')).toContainText('Bug');
    await expect(panel.getByTestId('prop-project')).toContainText(projectName);
    await expect(panel.getByTestId('prop-cycle')).toContainText(cycleName);
    await expect(panel.getByTestId('prop-status')).toContainText('Todo');
    await expect(panel.getByTestId('subscribe-toggle')).toHaveAttribute('aria-pressed', subscribedAfter);
  });

  test('comment keyboard submit, edit, reaction, and delete', async ({ page }) => {
    const title = uniqueTitle('Comment flow');
    await gotoTeam(page, 'ENG', 'backlog');
    const row = await createIssueViaKeyboard(page, title);
    await row.focus();
    await page.keyboard.press(' ');
    const panel = PANEL(page);
    await expect(panel).toBeVisible();

    const comment = uniqueTitle('First comment');
    const composer = panel.getByTestId('comment-composer').getByRole('textbox', { name: 'Comment' });
    await composer.fill(comment);
    await composer.press('Control+Enter');
    const item = panel.getByTestId('comment').filter({ hasText: comment });
    await expect(item).toBeVisible();

    await item.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Edit comment' }).click();
    const edited = `${comment} edited`;
    await item.getByRole('textbox', { name: 'Edit comment' }).fill(edited);
    await item.getByRole('button', { name: 'Save' }).click();
    await expect(item).toContainText(edited);

    await item.getByRole('button', { name: 'Add reaction' }).click();
    await page.getByRole('button', { name: '👍' }).click();
    await expect(item.getByRole('button', { name: /👍/ })).toHaveAttribute('aria-pressed', 'true');

    await item.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Delete comment' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(item).toBeHidden();
    await page.reload();
    await expect(panel.getByTestId('comment').filter({ hasText: edited })).toHaveCount(0);
  });

  test('sub-issues and relations persist', async ({ page }) => {
    const parentTitle = uniqueTitle('Parent');
    const targetTitle = uniqueTitle('Related target');
    const childTitle = uniqueTitle('Child');
    await gotoTeam(page, 'ENG', 'backlog');
    await createIssueViaKeyboard(page, targetTitle);
    const parent = await createIssueViaKeyboard(page, parentTitle);
    await parent.focus();
    await page.keyboard.press(' ');
    const panel = PANEL(page);
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: 'Add sub-issue' }).click();
    const modal = page.getByTestId('create-issue-modal');
    await expect(modal).toBeVisible();
    await page.getByTestId('create-issue-title').fill(childTitle);
    await page.getByTestId('create-issue-submit').click();
    await expect(modal).toBeHidden();
    await expect(panel.getByTestId('sub-issues')).toContainText(childTitle);

    await panel.getByRole('button', { name: 'Add relation' }).click();
    await page.getByRole('combobox', { name: 'Search' }).fill(targetTitle);
    await page.getByRole('option', { name: new RegExp(targetTitle) }).click();
    await expect(panel.getByTestId('relations')).toContainText(targetTitle);
    await page.reload();
    await expect(panel.getByTestId('sub-issues')).toContainText(childTitle);
    await expect(panel.getByTestId('relations')).toContainText(targetTitle);
  });
  test('a rejected edit applies optimistically, rolls back, and explains why in a flag', async ({ page }) => {
    const title = uniqueTitle('Rollback');
    await gotoTeam(page, 'ENG', 'backlog');
    const row = await createIssueViaKeyboard(page, title);
    await row.focus();
    await page.keyboard.press(' ');
    const panel = PANEL(page);
    await expect(panel.getByTestId('issue-title')).toHaveValue(title);
    const priority = panel.getByTestId('prop-priority');
    await expect(priority).not.toContainText('Urgent');
    const before = (await priority.innerText()).trim();

    // The server rejects this one UpdateIssue (after a delay, so the optimistic state is observable).
    let rejected = 0;
    await page.route('**/graphql', async (route) => {
      const body = route.request().postData() ?? '';
      if (rejected === 0 && body.includes('"operationName":"UpdateIssue"')) {
        rejected += 1;
        await new Promise((r) => setTimeout(r, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: null, errors: [{ message: 'Simulated rejection', extensions: { code: 'VALIDATION' } }] }),
        });
        return;
      }
      await route.continue();
    });

    await priority.click();
    await page.getByRole('option', { name: 'Urgent' }).click();
    await expect(priority).toContainText('Urgent'); // optimistic
    const flag = page.getByRole('alert').filter({ hasText: /Couldn.t update ENG-\d+/ });
    await expect(flag).toBeVisible();
    await expect(flag).toContainText('Simulated rejection.');
    await expect(priority).toHaveText(before); // rolled back
    await expect(row.getByRole('img', { name: 'Urgent' })).toHaveCount(0);
    expect(rejected).toBe(1);

    await page.unrouteAll({ behavior: 'wait' });
    await page.reload();
    await expect(PANEL(page).getByTestId('prop-priority')).toHaveText(before);
  });
});
