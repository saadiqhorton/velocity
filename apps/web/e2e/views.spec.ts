import { expect, test, uniqueTitle } from './support/fixtures';

async function addFilter(page: import('@playwright/test').Page, field: string, value: string): Promise<void> {
  await page.getByTestId('add-filter').click();
  await page.getByRole('option', { name: field, exact: true }).click();
  await page.getByText(value, { exact: true }).last().click();
}

function filterChip(page: import('@playwright/test').Page) {
  return page.getByTestId('filter-chip');
}

test.describe('views', () => {
  test('filter and display options are shareable in the URL', async ({ page, newSession }) => {
    await page.goto('/team/ENG/backlog');
    await expect(page.getByTestId('view-header')).toBeVisible();

    await addFilter(page, 'Priority', 'Urgent');
    await expect(filterChip(page)).toContainText('Priority');
    await expect(filterChip(page)).toContainText('Urgent');
    await expect(page).toHaveURL(/[?&]filter=.*priority/i);

    await page.getByTestId('display-options').click();
    await page.getByRole('combobox', { name: 'Grouping' }).selectOption('priority');
    await expect(page).toHaveURL(/[?&]group=priority(?:&|$)/);
    await expect(page.getByTestId('group-header').first()).toBeVisible();

    const sharedUrl = page.url();
    const second = await newSession();
    await second.page.goto(sharedUrl);
    await expect(filterChip(second.page)).toContainText('Priority');
    await expect(filterChip(second.page)).toContainText('Urgent');
    await expect(second.page).toHaveURL(/[?&]filter=.*priority/i);
    await expect(second.page).toHaveURL(/[?&]group=priority(?:&|$)/);
    await expect(second.page.getByTestId('group-header').first()).toBeVisible();
  });

  test('saved views receive a slug and retain their filter', async ({ page, newSession }) => {
    const name = uniqueTitle('E2E saved view');
    await page.goto('/view/new');
    await expect(page.getByTestId('view-header')).toBeVisible();

    await addFilter(page, 'Labels', 'Bug');
    await expect(filterChip(page)).toContainText('Bug');
    await page.getByLabel('View name').fill(name);
    await page.getByTestId('save-view').click();
    await expect(page).toHaveURL(/\/view\/[^/?#]+$/);
    const savedUrl = page.url();

    await page.goto('/views');
    await expect(page.getByTestId('views-list')).toContainText(name);

    const second = await newSession();
    await second.page.goto(savedUrl);
    await expect(filterChip(second.page)).toContainText('Bug');
  });
});
