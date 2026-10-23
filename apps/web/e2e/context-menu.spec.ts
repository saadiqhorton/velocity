import { expect, test, gotoTeam } from './support/fixtures';

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`context menu closes and returns focus with reduced motion ${reducedMotion}`, async ({ page, guard }) => {
    await page.emulateMedia({ reducedMotion });
    await gotoTeam(page, 'ENG');
    const row = page.getByTestId('issue-row').first();
    await row.focus();
    await page.keyboard.press('v');
    const menu = page.getByRole('menu', { name: 'Issue actions' });
    await expect(menu).toBeVisible();
    // Keyboard opening focuses the first item.
    await expect(menu.getByRole('menuitem').first()).toBeFocused();

    const closing = await menu.evaluate(async (element) => {
      const surface = element.closest('.bg-overlay') as HTMLElement;
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return {
        mounted: surface.isConnected,
        hidden: surface.getAttribute('aria-hidden'),
        pointerEvents: getComputedStyle(surface).pointerEvents,
        duration: getComputedStyle(surface).animationDuration,
      };
    });

    if (reducedMotion === 'no-preference') {
      expect(closing).toEqual({ mounted: true, hidden: 'true', pointerEvents: 'none', duration: '0.12s' });
    } else {
      expect(closing.mounted).toBe(false);
    }
    await expect(page.getByRole('menu', { name: 'Issue actions', includeHidden: true })).toHaveCount(0);
    await expect(row).toBeFocused();
    expect(guard.csp).toHaveLength(0);
  });
}
