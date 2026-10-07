import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

test.setup('create and authenticate the Velocity owner', { sessions: ['velocity-owner'] }, async ({ app, browser, screen, session }) => {
  const owner = credentials.user('velocity-owner');

  await app.open('/');
  await expect(browser).toHaveURL(/\/setup$/);
  await expect(screen.getByRole('heading', 'Set up your workspace')).toBeVisible();

  await screen.getByLabel('Display name').fill('Agent E2E Owner');
  await screen.getByLabel('Username').fill(owner.username);
  await screen.getByLabel('Password').fill(owner.password);
  await screen.getByLabel('Confirm password').fill(owner.password);
  await screen.getByRole('button', 'Continue').tap();

  await expect(screen.getByLabel('Workspace name')).toBeVisible();
  await screen.getByLabel('Workspace name').fill('Agent E2E Workspace');
  await screen.getByRole('button', 'Continue').tap();

  await expect(screen.getByLabel('Team name')).toHaveValue('Engineering');
  await expect(screen.getByLabel('Team key')).toHaveValue('ENG');
  await screen.getByRole('button', 'Continue').tap();

  await expect(screen.getByTestId('setup-github-continue')).toBeVisible();
  await screen.getByTestId('setup-github-continue').tap();
  await expect(screen.getByRole('heading', 'Your workspace is ready')).toBeVisible();
  await screen.getByRole('button', 'Open workspace').tap();

  await expect(browser).toHaveURL(/\/team\/ENG\/active$/);
  await expect(screen.getByRole('navigation', 'Primary')).toBeVisible();
  await session.save('velocity-owner');
});
