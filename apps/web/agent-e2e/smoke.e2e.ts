import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('Velocity loads', { requires: ['browser'], tags: ['smoke'] }, async ({ app, browser, screen }) => {
  await app.open('/');

  await expect(browser).toHaveTitle('Velocity');
  await expect(screen.getByRole('main')).toBeVisible();
});
