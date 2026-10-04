// First-run wizard (SPEC §3.3, §8.2): owner -> workspace -> first team -> optional GitHub -> done, < 2 minutes.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test as setup } from '@playwright/test';
import { resolveEnv } from './support/env.mjs';

export const OWNER = { username: 'e2e-owner', password: 'e2e-correct-horse-battery', name: 'E2E Owner' };

setup('first-run wizard through the UI', async ({ page }) => {
  const started = Date.now();
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);

  await expect(page.getByTestId('setup-step-owner')).toBeVisible();
  await page.getByLabel('Display name').fill(OWNER.name);
  await page.getByLabel('Username').fill(OWNER.username);
  await page.getByLabel(/^Password/).fill(OWNER.password);
  await page.getByLabel('Confirm password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByTestId('setup-step-workspace')).toBeVisible();
  await page.getByLabel('Workspace name').fill('E2E Workspace');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByTestId('setup-step-team')).toBeVisible();
  await expect(page.getByLabel('Team key')).toHaveValue('ENG');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByTestId('setup-step-github')).toBeVisible();
  await page.getByTestId('setup-github-continue').click();

  await expect(page.getByTestId('setup-step-done')).toBeVisible();
  await page.getByTestId('setup-finish').click();
  await expect(page).toHaveURL(/\/team\/ENG\/active/);
  await expect(page.getByTestId('view-header')).toBeVisible();

  expect(Date.now() - started, 'wizard completes in under two minutes').toBeLessThan(120_000);

  const { authFile } = resolveEnv();
  mkdirSync(dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
