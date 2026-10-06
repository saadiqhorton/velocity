import type { Page } from '@playwright/test';
import { createIssueViaKeyboard, expect, focusedLabel, gotoTeam, graphqlAs, rowByTitle, test, uniqueTitle } from './support/fixtures';
import { defaultConfig } from '../src/stores/codingTools';

/** Roadmap v1.2: U1 (full issue page), U2 (copy actions, context menu), U3 (Open in), U4 (Solo mode). */

const ALL_ON = 'mutation { updateWorkspaceFeatures(input: { cycles: true, estimates: true, insights: true, members: true }) { slug } }';

async function clipboard(page: Page, browserName: string): Promise<string | null> {
  // Reading the clipboard back is only reliable in Chromium; other engines assert the flag only.
  if (browserName !== 'chromium') return null;
  return page.evaluate(() => navigator.clipboard.readText());
}

function flag(page: Page, text: string | RegExp) {
  return page.getByRole('status').filter({ hasText: text }).first();
}

test.describe('issue page (U1)', () => {
  test('Enter opens the full page; J/K step through the list; Esc returns to the same row and scroll', async ({ page }) => {
    await gotoTeam(page, 'ENG', 'backlog');
    const list = page.getByTestId('issue-list');
    // Scroll a little so the return has a position to restore.
    await list.evaluate((el) => (el.scrollTop = 160));
    const third = page.getByTestId('issue-row').nth(8);
    await third.focus();
    const label = (await focusedLabel(page)) ?? '';
    const scrollBefore = await list.evaluate((el) => el.scrollTop);
    expect(scrollBefore).toBeGreaterThan(0);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/issue\/ENG-\d+$/);
    await expect(page.getByTestId('detail-panel')).toHaveCount(0);
    const header = page.getByTestId('issue-page-header');
    await expect(header).toBeVisible();
    await expect(header.getByTestId('issue-breadcrumb-list')).toHaveText('Engineering · Backlog');
    const stepper = page.getByTestId('issue-stepper');
    await expect(stepper).toContainText(/^\s*\d+ \/ \d+/);
    const first = Number(/(\d+) \//.exec((await stepper.innerText()) ?? '')?.[1]);
    const opened = page.url();

    // J steps to the next issue in the originating list (replacing the history entry).
    await page.keyboard.press('j');
    await expect(page).not.toHaveURL(opened);
    await expect(stepper).toContainText(`${first + 1} /`);
    const stepped = (await page.getByTestId('issue-identifier').innerText()).trim();
    await page.keyboard.press('k');
    await expect(stepper).toContainText(`${first} /`);
    await page.getByTestId('issue-next').click();
    await expect(page.getByTestId('issue-identifier')).toHaveText(stepped);

    // Esc returns to the list with the stepped-to row focused and the scroll kept.
    await page.locator('body').click({ position: { x: 5, y: 600 } }).catch(() => undefined);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/team\/ENG\/backlog$/);
    await expect.poll(() => focusedLabel(page)).toContain(stepped);
    expect(label).not.toContain(stepped);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  });

  test('Backspace, the breadcrumb and browser Back all return to the list', async ({ page }) => {
    const title = uniqueTitle('Page nav');
    await gotoTeam(page, 'ENG', 'backlog');
    const row = await createIssueViaKeyboard(page, title);

    await row.click();
    await expect(page.getByTestId('issue-title')).toHaveValue(title);
    await page.goBack();
    await expect(page).toHaveURL(/\/team\/ENG\/backlog$/);

    await rowByTitle(page, title).click();
    await expect(page.getByTestId('issue-title')).toHaveValue(title);
    await page.getByTestId('issue-breadcrumb-list').click();
    await expect(page).toHaveURL(/\/team\/ENG\/backlog$/);
    await expect(rowByTitle(page, title)).toBeFocused();

    await rowByTitle(page, title).focus();
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId('issue-title')).toHaveValue(title);
    await page.getByTestId('issue-page-header').click({ position: { x: 400, y: 24 } });
    await page.keyboard.press('Backspace');
    await expect(page).toHaveURL(/\/team\/ENG\/backlog$/);
  });

  test('opened directly, the page falls back to the team list and Esc goes there', async ({ page }) => {
    await gotoTeam(page, 'ENG', 'active');
    const id = (await page.getByTestId('issue-row').first().locator('.identifier').innerText()).trim();
    await page.goto(`/issue/${id}`);
    await expect(page.getByTestId('issue-stepper')).toContainText('1 /');
    await expect(page.getByTestId('issue-breadcrumb-list')).toHaveText('Engineering');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/team\/ENG\/active$/);
  });

  test('Space peeks in the side panel; Space and Esc close it', async ({ page }) => {
    await gotoTeam(page, 'ENG', 'backlog');
    const row = page.getByTestId('issue-row').first();
    await row.focus();
    await page.keyboard.press(' ');
    const panel = page.getByTestId('detail-panel');
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/\/team\/ENG\/backlog\?issue=/);
    await expect(row).toBeFocused();
    await page.keyboard.press(' ');
    await expect(panel).toBeHidden();
    await page.keyboard.press(' ');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(row).toBeFocused();
  });

  test('attachments upload, download and delete persist on the full page', async ({ page }) => {
    const title = uniqueTitle('Attachment round trip');
    await gotoTeam(page, 'ENG', 'backlog');
    const row = await createIssueViaKeyboard(page, title);
    await row.click();
    const attachments = page.getByTestId('attachments');
    await expect(attachments).toBeVisible();

    const content = 'Attachment round trip from the issue page.\n';
    await attachments.locator('input[type="file"]').setInputFiles({
      name: 'verification.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(content),
    });
    const file = attachments.getByRole('link', { name: 'verification.txt' });
    await expect(file).toBeVisible();
    const url = await file.getAttribute('href');
    expect(url).toBeTruthy();
    const download = await page.request.get(new URL(url!, page.url()).toString());
    expect(download.ok()).toBe(true);
    expect(await download.text()).toBe(content);

    await page.reload();
    await expect(attachments.getByRole('link', { name: 'verification.txt' })).toBeVisible();
    await attachments.getByRole('button', { name: 'Delete verification.txt' }).click();
    await expect(attachments.getByRole('link', { name: 'verification.txt' })).toHaveCount(0);
    await page.reload();
    await expect(attachments.getByRole('link', { name: 'verification.txt' })).toHaveCount(0);
  });
});

test.describe('copy actions and context menu (U2)', () => {
  test('copy shortcuts on the page show a flag and fill the clipboard', async ({ page, browserName, context }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const title = uniqueTitle('Copy ünïcode');
    await gotoTeam(page, 'ENG', 'backlog');
    const row = await createIssueViaKeyboard(page, title);
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('issue-title')).toHaveValue(title);
    const id = (await page.getByTestId('issue-identifier').innerText()).trim();

    await page.keyboard.press('Control+.');
    await expect(flag(page, `Copied ${id}`)).toBeVisible();
    const copiedId = await clipboard(page, browserName);
    if (copiedId !== null) expect(copiedId).toBe(id);

    await page.keyboard.press('Control+Shift+.');
    const branch = `${id.toLowerCase()}-copy-unicode-`;
    await expect(flag(page, `Copied ${branch}`)).toBeVisible();
    const copiedBranch = await clipboard(page, browserName);
    if (copiedBranch !== null) expect(copiedBranch).toMatch(/^[a-z0-9-]{1,60}$/);

    await page.keyboard.press('Control+Shift+,');
    await expect(flag(page, `Copied link to ${id}`)).toBeVisible();
    const link = await clipboard(page, browserName);
    if (link !== null) expect(link).toMatch(/\/issue\/[0-9a-f-]{36}$/);

    await page.keyboard.press('Control+Alt+p');
    await expect(flag(page, `Copied ${id} as a prompt`)).toBeVisible();
    const prompt = await clipboard(page, browserName);
    if (prompt !== null) {
      expect(prompt.startsWith(`# ${id}: ${title}\n`)).toBe(true);
      expect(prompt).toContain('**Status:**');
      expect(prompt).toContain('## Working agreement');
      expect(prompt).toContain(`Fixes ${id}`);
    }
  });

  test('right-click, Shift+F10 and the page ⋯ open the issue menu', async ({ page }) => {
    await gotoTeam(page, 'ENG', 'backlog');
    const row = page.getByTestId('issue-row').nth(1);
    await row.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Issue actions' });
    await expect(menu).toBeVisible();
    for (const item of ['Status', 'Priority', 'Assignee', 'Labels', 'Project', 'Copy', 'Open in', 'Move to team', 'Archive', 'Delete']) {
      // Items carry their shortcut hint in the accessible name ("Status S").
      await expect(menu.getByRole('menuitem', { name: new RegExp(`^${item}`) }).first()).toBeVisible();
    }
    await expect(page).toHaveURL(/\/team\/ENG\/backlog$/);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await row.focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await row.focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('issue-more').click();
    const more = page.getByRole('menu', { name: 'Issue actions' });
    await expect(more.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible();
    await more.getByRole('menuitem', { name: 'Copy', exact: true }).hover();
    await expect(page.getByRole('menu', { name: 'Copy' }).getByRole('menuitem', { name: /Copy as prompt/ })).toBeVisible();
  });

  test('the palette copies an issue as a prompt', async ({ page, browserName, context }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await gotoTeam(page, 'ENG', 'backlog');
    await page.getByTestId('issue-row').first().focus();
    await page.keyboard.press('Control+k');
    const palette = page.getByTestId('command-palette');
    await palette.getByRole('combobox').fill('>copy issue as prompt');
    await expect(palette.getByRole('option', { name: 'Copy issue as prompt' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(flag(page, /as a prompt/)).toBeVisible();
  });
});

test.describe('open in coding tools (U3)', () => {
  test.afterEach(async ({ page }) => {
    // Settings now persist for the signed-in user, so leave the shared E2E owner clean.
    const defaults = defaultConfig();
    await graphqlAs(page, 'mutation ResetPreferences($input: UpdatePreferencesInput!) { updatePreferences(input: $input) { promptInstructions } }', { input: { codingTools: defaults.tools, promptInstructions: defaults.instructions } });
  });

  test('a CLI tool copies a ready-to-run command; settings persist for this member only', async ({ page, browserName, context, browser }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/settings/coding-tools');
    const settings = page.getByTestId('settings-coding-tools');
    await expect(settings.getByTestId('coding-tool')).toHaveCount(6);
    await settings.getByRole('textbox', { name: 'Name' }).fill('My agent');
    await settings.getByRole('textbox', { name: 'Template' }).fill('myagent --branch {branch} {prompt}');
    await settings.getByRole('button', { name: 'Add tool' }).click();
    await expect(settings.getByTestId('coding-tool')).toHaveCount(7);
    await settings.getByTestId('prompt-instructions').fill('Run the e2e suite before you finish.');
    await settings.getByTestId('prompt-instructions').blur();
    await expect.poll(async () => {
      const data = await graphqlAs(page, 'query { viewer { preferences { codingTools { name } promptInstructions } } }');
      const viewer = data.viewer as { preferences?: { codingTools: { name: string }[]; promptInstructions: string } };
      return [viewer.preferences?.codingTools.some((tool) => tool.name === 'My agent'), viewer.preferences?.promptInstructions];
    }).toEqual([true, 'Run the e2e suite before you finish.']);

    await page.reload();
    await expect(page.getByTestId('settings-coding-tools').getByTestId('coding-tool')).toHaveCount(7);

    // The one-time legacy migration only runs for a member who has never saved server preferences.
    // The shared seed users accumulate them (this suite's own cleanup writes defaults), so a fresh
    // member keeps the test independent of run order and repeats.
    const invite = await graphqlAs(page, 'mutation { createInvite(name: "Legacy member") { url } }');
    const inviteUrl = new URL((invite.createInvite as { url: string }).url);
    const username = `legacy${Date.now().toString(36).slice(-8)}`;
    const otherContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    let memberId = '';
    try {
      const other = await otherContext.newPage();
      await other.goto(inviteUrl.pathname);
      await other.evaluate((config) => window.localStorage.setItem('velocity.codingTools.v1', JSON.stringify(config)), { ...defaultConfig(), instructions: 'Legacy setting for the new member' });
      await other.getByRole('textbox', { name: 'Username' }).fill(username);
      await other.getByRole('textbox', { name: 'Password' }).fill('correct-horse-battery-staple');
      await other.getByRole('button', { name: 'Create account' }).click();
      await expect(other).toHaveURL(/\/team\//);
      await other.goto('/settings/coding-tools');
      await expect(other.getByRole('list', { name: 'Tools' }).getByRole('listitem')).toHaveCount(6);
      await expect(other.getByRole('textbox', { name: 'Custom instructions' })).toHaveValue('Legacy setting for the new member');
      await expect.poll(async () => {
        const data = await graphqlAs(other, 'query { viewer { preferences { promptInstructions } } }');
        return (data.viewer as { preferences?: { promptInstructions: string } }).preferences?.promptInstructions;
      }).toBe('Legacy setting for the new member');
      // The client clears the legacy copy only after the server confirms, so it trails the poll above.
      await expect.poll(() => other.evaluate(() => window.localStorage.getItem('velocity.codingTools.v1'))).toBeNull();
      memberId = ((await graphqlAs(other, 'query { viewer { id } }')).viewer as { id: string }).id;
    } finally {
      await otherContext.close();
      if (memberId) await graphqlAs(page, 'mutation ($id: ID!) { removeMember(userId: $id) }', { id: memberId });
    }

    await gotoTeam(page, 'ENG', 'backlog');
    await page.getByTestId('issue-row').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('issue-page-header')).toBeVisible();

    await page.getByTestId('prompt-options').click();
    await page.getByRole('menuitem', { name: 'Open issue in Claude Code' }).click();
    await expect(flag(page, 'Claude Code command copied')).toBeVisible();
    const command = await clipboard(page, browserName);
    if (command !== null) {
      expect(command.startsWith(`claude "$(cat <<'VELOCITY_PROMPT'\n# ENG-`)).toBe(true);
      expect(command).toContain('Run the e2e suite before you finish.');
      expect(command.trimEnd().endsWith('VELOCITY_PROMPT\n)"')).toBe(true);
    }

    await page.getByTestId('prompt-options').click();
    await page.getByRole('menuitem', { name: 'Open issue in My agent' }).click();
    await expect(flag(page, 'My agent command copied')).toBeVisible();
    const custom = await clipboard(page, browserName);
    if (custom !== null) expect(custom).toMatch(/^myagent --branch 'eng-\d+-[a-z0-9-]*' "\$\(cat <<'VELOCITY_PROMPT'/);

    // The first tool's shortcut (Ctrl/⌘+Alt+.) launches it from the keyboard.
    await page.keyboard.press('Control+Alt+.');
    await expect(flag(page, 'Claude Code command copied').nth(0)).toBeVisible();
  });
});

test.describe('solo mode (U4)', () => {
  test.beforeEach(async ({ page }) => {
    await graphqlAs(page, ALL_ON);
  });
  test.afterEach(async ({ page }) => {
    await graphqlAs(page, ALL_ON);
  });

  test('the Solo mode switch hides cycles, estimates, insights and member management', async ({ page }) => {
    await page.goto('/settings/features');
    const solo = page.getByTestId('feature-solo');
    await expect(solo).toHaveAttribute('aria-checked', 'false');
    await solo.click();
    await expect(solo).toHaveAttribute('aria-checked', 'true');
    for (const key of ['cycles', 'estimates', 'insights', 'members']) {
      await expect(page.getByTestId(`feature-${key}`)).toHaveAttribute('aria-checked', 'false');
    }
    const settingsNav = page.getByTestId('settings-nav');
    await expect(settingsNav.getByRole('link', { name: 'Members' })).toHaveCount(0);

    // Lean sidebar: no Cycles and no per-team Projects; the team list is called Issues.
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar.getByRole('link', { name: 'Cycles' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Issues' }).first()).toBeVisible();

    await page.goto('/team/ENG/active');
    await expect(page.getByTestId('cycle-picker')).toHaveCount(0);
    await page.getByTestId('display-options').click();
    const display = page.getByRole('dialog', { name: 'Display' });
    await expect(display.getByRole('checkbox', { name: 'Estimate' }).or(display.getByText('Estimate', { exact: true }))).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByTestId('issue-row').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('issue-sidebar')).toBeVisible();
    await expect(page.getByTestId('prop-cycle')).toHaveCount(0);
    await expect(page.getByTestId('prop-estimate')).toHaveCount(0);

    await page.goto('/team/ENG/cycles');
    await expect(page.getByTestId('feature-off-cycles')).toBeVisible();
    await page.goto('/insights');
    await expect(page.getByTestId('feature-off-insights')).toBeVisible();
    await page.goto('/settings/members');
    await expect(page.getByTestId('feature-off-members')).toBeVisible();

    // Turning one feature back on brings its screens back.
    await page.goto('/settings/features');
    await page.getByTestId('feature-cycles').click();
    await expect(page.getByTestId('feature-solo')).toHaveAttribute('aria-checked', 'false');
    await page.goto('/team/ENG/cycles');
    await expect(page.getByTestId('feature-off-cycles')).toHaveCount(0);
  });
});
