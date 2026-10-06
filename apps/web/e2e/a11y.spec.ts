import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { expect, gotoTeam, test } from './support/fixtures';

const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function analyze(page: Page, testInfo: TestInfo, screen: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(axeTags).analyze();
  const format = (violation: (typeof result.violations)[number]): string =>
    `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`;
  const serious = result.violations.filter((violation) => violation.impact === 'serious');
  if (serious.length > 0) {
    await testInfo.attach(`axe-serious-${screen}`, {
      body: serious.map(format).join('\n'),
      contentType: 'text/plain',
    });
  }
  const critical = result.violations.filter((violation) => violation.impact === 'critical');
  expect(critical.map(format), `${screen} has critical accessibility violations`).toEqual([]);
}

async function openList(page: Page): Promise<void> {
  await gotoTeam(page, 'ENG', 'active');
}

test.describe('accessibility screens', () => {
  test('login signed out', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ storageState: undefined });
    try {
      const page = await context.newPage();
      await page.goto('/login');
      await expect(page.getByLabel('Username or email')).toBeVisible();
      await expect(page.getByLabel('Password')).toBeVisible();
      await analyze(page, testInfo, 'login');
    } finally {
      await context.close();
    }
  });

  test('active team list', async ({ page }, testInfo) => {
    await openList(page);
    await analyze(page, testInfo, 'team-active');
  });

  test('active team list with issue panel', async ({ page }, testInfo) => {
    await openList(page);
    await page.keyboard.press('j');
    await page.keyboard.press(' ');
    await expect(page.getByTestId('issue-detail')).toBeVisible();
    await analyze(page, testInfo, 'team-active-panel');
  });

  test('command palette open', async ({ page }, testInfo) => {
    await openList(page);
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await analyze(page, testInfo, 'command-palette');
  });

  test('create issue modal', async ({ page }, testInfo) => {
    await openList(page);
    await page.keyboard.press('c');
    await expect(page.getByTestId('create-issue-modal')).toBeVisible();
    await analyze(page, testInfo, 'create-issue-modal');
  });

  test('profile settings', async ({ page }, testInfo) => {
    await page.goto('/settings/profile');
    await expect(page.getByRole('textbox').first()).toBeVisible();
    await analyze(page, testInfo, 'settings-profile');
  });

  test('inbox', async ({ page }, testInfo) => {
    await page.goto('/inbox');
    await expect(page.getByTestId('inbox')).toBeVisible();
    await expect(page.getByTestId('view-header')).toBeVisible();
    await analyze(page, testInfo, 'inbox');
  });

  test('projects', async ({ page }, testInfo) => {
    await page.goto('/projects');
    await expect(page.getByTestId('projects-list')).toBeVisible();
    await expect(page.getByTestId('view-header')).toBeVisible();
    await analyze(page, testInfo, 'projects');
  });

  test('team cycles', async ({ page }, testInfo) => {
    await page.goto('/team/ENG/cycles');
    await expect(page.getByRole('heading', { name: 'Cycles' })).toBeVisible();
    await analyze(page, testInfo, 'team-cycles');
  });

  test('team workflow settings', async ({ page }, testInfo) => {
    await page.goto('/settings/teams/ENG/workflow');
    await expect(page.getByTestId('workflow-editor')).toBeVisible();
    await analyze(page, testInfo, 'team-workflow');
  });
});
