import { expect, test } from './support/fixtures';

const cases = [
  { width: 1440, height: 900, colorScheme: 'dark' as const },
  { width: 1440, height: 900, colorScheme: 'light' as const },
  { width: 1024, height: 768, colorScheme: 'dark' as const },
  { width: 1024, height: 768, colorScheme: 'light' as const },
];

for (const { width, height, colorScheme } of cases) {
  test(`layout ${width} ${colorScheme}`, async ({ newSession }) => {
    const { context, page } = await newSession({ viewport: { width, height }, colorScheme });
    await context.addInitScript((theme) => {
      localStorage.setItem('vel.theme', theme);
    }, colorScheme);

    await page.goto('/team/ENG/active');
    await expect(page.getByTestId('view-header')).toBeVisible();
    await expect(page.getByTestId('issue-row').first()).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);

    const sidebar = page.getByTestId('sidebar');
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox).not.toBeNull();
    expect(sidebarBox?.y).toBe(0);
    expect(sidebarBox?.height).toBe(height);
    expect(page.getByRole('banner')).toHaveCount(0);

    const wideTopElements = await page.evaluate((sidebarElement) => {
      const viewportWidth = window.innerWidth;
      return [...document.querySelectorAll<HTMLElement>('*')].filter((element) => {
        if (element === sidebarElement) return false;
        const position = getComputedStyle(element).position;
        if (position !== 'fixed' && position !== 'sticky') return false;
        const rect = element.getBoundingClientRect();
        return rect.y < 8 && rect.width >= viewportWidth * 0.9;
      }).length;
    }, await sidebar.elementHandle());
    expect(wideTopElements).toBe(0);

    expect(sidebarBox?.width).toBeCloseTo(width === 1440 ? 220 : 180, -1);
    expect((await page.getByTestId('view-header').boundingBox())?.height).toBeCloseTo(48, -1);
    expect((await page.getByTestId('issue-row').first().boundingBox())?.height).toBeCloseTo(32, -1);

    const workspaceName = page.getByTestId('workspace-name');
    const search = page.locator('#sidebar-search');
    const inbox = sidebar.getByRole('link', { name: /^Inbox/ });
    const myIssues = sidebar.getByRole('link', { name: 'My issues', exact: true });
    const teams = sidebar.getByRole('button', { name: 'Teams', exact: true });
    const projects = sidebar.getByRole('button', { name: 'Projects', exact: true });
    const newMenu = sidebar.getByRole('button', { name: 'New', exact: true });
    const settings = sidebar.getByRole('button', { name: 'Settings', exact: true });
    const account = page.getByTestId('account-menu');
    const orderedElements = [workspaceName, search, inbox, myIssues, teams, projects, newMenu, settings, account];
    // The nav scrolls once there are enough teams/projects, so compare document order rather than
    // viewport Y (a scrolled-out item can sit below the fixed bottom bar in screen space).
    const handles = await Promise.all(orderedElements.map((element) => element.elementHandle()));
    expect(handles.every((h): h is NonNullable<typeof h> => h !== null)).toBe(true);
    const ordered = await page.evaluate((els) => {
      for (let i = 0; i < els.length - 1; i += 1) {
        if (!(els[i]!.compareDocumentPosition(els[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      }
      return true;
    }, handles);
    expect(ordered).toBe(true);

    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    const detailPanel = page.getByTestId('detail-panel');
    await expect(detailPanel).toBeVisible();
    expect((await detailPanel.boundingBox())?.width).toBeCloseTo(width === 1440 ? 400 : 360, -1);
  });
}

test('phone settings: the section menu replaces the hidden section list', async ({ newSession }) => {
  const { page } = await newSession({ viewport: { width: 390, height: 844 } });
  await page.goto('/settings/profile');
  await expect(page.getByTestId('settings-profile')).toBeVisible();
  await expect(page.getByTestId('settings-nav')).toBeHidden();

  const trigger = page.getByRole('button', { name: 'Sections', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Settings sections' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
  await expect(menu.getByRole('menuitem', { name: 'Profile' })).toBeFocused();
  // The whole list fits on a phone (or scrolls inside the popup), never off-screen.
  const box = await menu.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);

  await menu.getByRole('menuitem', { name: 'Members' }).click();
  await expect(page).toHaveURL(/\/settings\/members$/);
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  // From 768 up the section list is back and the menu is gone.
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByTestId('settings-nav')).toBeVisible();
  await expect(page.getByTestId('settings-section-menu')).toBeHidden();
});
