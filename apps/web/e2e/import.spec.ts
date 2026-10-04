import { expect, test } from './support/fixtures';
import { generateLinearCsv } from '../../../packages/importers/scripts/generate-linear-csv';

test('imports 1,000 CSV issues through mapping, dry run, and live commit', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/settings/import');
  await expect(page.getByTestId('settings-import')).toBeVisible();
  await page.getByRole('button', { name: 'New import' }).click();
  await expect(page.getByTestId('import-source')).toBeVisible();

  await page.getByTestId('import-file').setInputFiles({
    name: 'linear-e2e-1000.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(generateLinearCsv(1000)),
  });
  await expect(page.getByTestId('import-continue')).toBeEnabled();
  await page.getByTestId('import-continue').click();

  await expect(page.getByTestId('import-mapping')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('import-summary')).toContainText('1000 issues');
  await expect(page.getByTestId('mapping-teams').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('mapping-users').locator('[data-unmapped="true"]').first()).toBeVisible();

  await page.getByTestId('import-dry-run').click();
  await expect(page.getByTestId('import-dryrun')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('grid', { name: 'Dry run report' })).toContainText('1000');
  await page.getByTestId('import-commit').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import 1000 issues' }).click();

  await expect(page.getByTestId('import-commit-step')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('import-counts')).toContainText('1000 of 1000', { timeout: 120_000 });
  await expect(page.getByText('Import completed')).toBeVisible();
  await page.goto('/settings/import');
  await expect(page.getByTestId('import-runs')).toContainText('linear-e2e-1000.csv');
  await page.goto('/search?q=Issue%201%3A%20handle');
  await expect(page.getByRole('grid', { name: 'Search results' })).toContainText('Issue 1: handle');
});
