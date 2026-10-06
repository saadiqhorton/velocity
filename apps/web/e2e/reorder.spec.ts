// SPEC §4.8 (issue reordering): Alt+ArrowUp/Down keyboard shortcuts and drag/drop for manual ordering.
import { expect, test, createIssueViaKeyboard, uniqueTitle, gotoTeam } from './support/fixtures';

test.describe('issue reordering', () => {
  test('Alt+ArrowDown swaps focused row within its group and persists after reload', async ({ page }) => {
    const titleA = uniqueTitle('Reorder A');
    const titleB = uniqueTitle('Reorder B');
    await gotoTeam(page, 'ENG', 'backlog');

    // Create two issues A then B; new issues appear at the top of the manual-ordered backlog.
    await createIssueViaKeyboard(page, titleA);
    const rowB = await createIssueViaKeyboard(page, titleB);

    // Read their visual order (index among getByTestId('issue-row')).
    const rows = page.getByTestId('issue-row');
    const rowIndexesBefore = await rows.evaluateAll((elements) => {
      let aIdx = -1, bIdx = -1;
      elements.forEach((el, idx) => {
        const text = el.textContent ?? '';
        if (text.includes('Reorder A')) aIdx = idx;
        if (text.includes('Reorder B')) bIdx = idx;
      });
      return [aIdx, bIdx];
    });
    const [indexABefore, indexBBefore] = rowIndexesBefore;
    expect(indexBBefore).toBeLessThan(indexABefore); // B is above A initially

    // Focus B's row (a click would open the issue page, U1).
    await rowB.focus();
    await expect(rowB).toBeFocused();

    // Press Alt+ArrowDown to swap B down (towards A).
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForTimeout(200); // Brief wait for the reorder to settle

    // Assert the order of A and B flipped.
    const rowIndexesAfter = await rows.evaluateAll((elements) => {
      let aIdx = -1, bIdx = -1;
      elements.forEach((el, idx) => {
        const text = el.textContent ?? '';
        if (text.includes('Reorder A')) aIdx = idx;
        if (text.includes('Reorder B')) bIdx = idx;
      });
      return [aIdx, bIdx];
    });
    const [indexAAfter, indexBAfter] = rowIndexesAfter;
    expect(indexBAfter).toBeGreaterThan(indexAAfter); // B is now below A

    // Reload and assert the new order persisted.
    await page.reload();
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    const rowIndexesAfterReload = await rows.evaluateAll((elements) => {
      let aIdx = -1, bIdx = -1;
      elements.forEach((el, idx) => {
        const text = el.textContent ?? '';
        if (text.includes('Reorder A')) aIdx = idx;
        if (text.includes('Reorder B')) bIdx = idx;
      });
      return [aIdx, bIdx];
    });
    const [indexAReload, indexBReload] = rowIndexesAfterReload;
    expect(indexBReload).toBeGreaterThan(indexAReload);
  });

  test('Alt+ArrowUp swaps focused row up within its group and persists', async ({ page }) => {
    const titleA = uniqueTitle('ReorderUp A');
    const titleB = uniqueTitle('ReorderUp B');
    await gotoTeam(page, 'ENG', 'backlog');

    // Create two issues; B is at the top after creation.
    const rowA = await createIssueViaKeyboard(page, titleA);
    await createIssueViaKeyboard(page, titleB);

    // Focus A and move it up past B.
    const rows = page.getByTestId('issue-row');
    await rowA.focus();

    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForTimeout(200); // Brief wait for the reorder to settle

    // Assert A is now above B.
    const rowIndexesAfter = await rows.evaluateAll((elements) => {
      let aIdx = -1, bIdx = -1;
      elements.forEach((el, idx) => {
        const text = el.textContent ?? '';
        if (text.includes('ReorderUp A')) aIdx = idx;
        if (text.includes('ReorderUp B')) bIdx = idx;
      });
      return [aIdx, bIdx];
    });
    const [indexAAfter, indexBAfter] = rowIndexesAfter;
    expect(indexAAfter).toBeLessThan(indexBAfter);

    // Reload and verify persistence.
    await page.reload();
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    const rowIndexesAfterReload = await rows.evaluateAll((elements) => {
      let aIdx = -1, bIdx = -1;
      elements.forEach((el, idx) => {
        const text = el.textContent ?? '';
        if (text.includes('ReorderUp A')) aIdx = idx;
        if (text.includes('ReorderUp B')) bIdx = idx;
      });
      return [aIdx, bIdx];
    });
    const [indexAReload, indexBReload] = rowIndexesAfterReload;
    expect(indexAReload).toBeLessThan(indexBReload);
  });

  test('drag row A onto row B lower half reorders and persists', async ({ page }) => {
    const titleA = uniqueTitle('Drag A');
    const titleB = uniqueTitle('Drag B');
    await gotoTeam(page, 'ENG', 'backlog');

    // Create two issues.
    await createIssueViaKeyboard(page, titleA);
    await createIssueViaKeyboard(page, titleB);

    // Drag A's row onto B's row (lower half) using dragTo with targetPosition on lower half.
    const rows = page.getByTestId('issue-row');
    const rowAElem = rows.filter({ hasText: titleA });
    const rowBElem = rows.filter({ hasText: titleB });

    // Use dragTo with target position on the lower half of B (y: 28 of 32px height).
    await rowAElem.dragTo(rowBElem, { targetPosition: { x: 50, y: 28 } });

    // Wait for the drag to settle
    await page.waitForTimeout(200);

    // Assert the order changes: A should now be after B.
    const rowIndexesAfterDrag = await rows.evaluateAll((elements) => {
      let aIdx = -1, bIdx = -1;
      elements.forEach((el, idx) => {
        const text = el.textContent ?? '';
        if (text.includes('Drag A')) aIdx = idx;
        if (text.includes('Drag B')) bIdx = idx;
      });
      return [aIdx, bIdx];
    });
    const [indexAAfterDrag, indexBAfterDrag] = rowIndexesAfterDrag;
    expect(indexAAfterDrag).toBeGreaterThan(indexBAfterDrag);

    // Reload and assert the new order persisted.
    await page.reload();
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    const rowIndexesAfterReload = await rows.evaluateAll((elements) => {
      let aIdx = -1, bIdx = -1;
      elements.forEach((el, idx) => {
        const text = el.textContent ?? '';
        if (text.includes('Drag A')) aIdx = idx;
        if (text.includes('Drag B')) bIdx = idx;
      });
      return [aIdx, bIdx];
    });
    const [indexAReload, indexBReload] = rowIndexesAfterReload;
    expect(indexAReload).toBeGreaterThan(indexBReload);
  });
});
