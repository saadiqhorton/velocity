// SPEC §4.10.2: a virtualized list must load every issue without gaps or duplicates.
import { expect, test } from './support/fixtures';

test.describe('infinite scroll', () => {
  test('visiting every part of a 400-issue list loads each row exactly once', async ({ page }) => {
    await page.goto('/issues?group=none&done=all');
    const list = page.getByTestId('issue-list');
    await expect(list).toBeVisible();
    await expect(page.getByTestId('issue-row').first()).toBeVisible();

    const countText = await page.getByTestId('view-count').textContent();
    const total = Number(countText?.match(/\d+/)?.[0] ?? 0);
    expect(total).toBeGreaterThanOrEqual(400);

    const byIndex = new Map<number, string>();
    const identifiers = new Set<string>();
    const step = 16; // Half a viewport, so virtualization cannot skip unseen rows.
    for (let start = 0; start < total; start += step) {
      await list.evaluate((el, index) => { el.scrollTop = index * 32; }, start);
      await expect.poll(async () => {
        const visible = await page.getByTestId('issue-row').evaluateAll((rows) =>
          rows.map((row) => Number(row.getAttribute('aria-rowindex'))),
        );
        return Math.max(0, ...visible);
      }).toBeGreaterThanOrEqual(Math.min(total, start + step));

      const visible = await page.getByTestId('issue-row').evaluateAll((rows) =>
        rows.map((row) => ({
          index: Number(row.getAttribute('aria-rowindex')),
          identifier: row.querySelector('.identifier')?.textContent?.trim() ?? '',
        })),
      );
      for (const { index, identifier } of visible) {
        expect(identifier).toMatch(/^[A-Z]+-\d+$/);
        const prior = byIndex.get(index);
        if (prior) expect(identifier).toBe(prior);
        byIndex.set(index, identifier);
        identifiers.add(identifier);
      }
    }

    expect(byIndex.size).toBe(total);
    expect(identifiers.size).toBe(total);
    for (let index = 1; index <= total; index++) expect(byIndex.has(index), `missing row ${index}`).toBe(true);

    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByTestId('issue-row').last()).toHaveAttribute('aria-rowindex', String(total));
    await expect(list.locator(':scope > div > div > div[aria-hidden="true"]')).toHaveCount(0);
  });

  test('team list loads beyond its first page', async ({ page }) => {
    await page.goto('/team/ENG/all?group=none&done=all');
    const list = page.getByTestId('issue-list');
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    const countText = await page.getByTestId('view-count').textContent();
    const total = Number(countText?.match(/\d+/)?.[0] ?? 0);
    expect(total).toBeGreaterThan(100);
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByTestId('issue-row').last()).toHaveAttribute('aria-rowindex', String(total));
  });
});
