import { test } from '@e2e-dev/web';
import { expect, unique } from 'e2e';

test(
  'a signed-in user creates, updates, and later finds an issue',
  { session: 'velocity-owner', requires: ['browser'], tags: ['semantic'] },
  async ({ app, agent, browser, screen }) => {
    const title = `Agent journey ${Date.now().toString(36)}`;

    await app.open('/team/ENG/backlog');
    await expect(screen.getByRole('main')).toBeVisible();

    await agent.act('create an issue called {title} in the Engineering team', {
      params: { title: unique(title) },
    });
    await expect(screen.getByTestId('issue-row').filter({ hasText: title })).toBeVisible();

    await agent.act('open the issue called {title}', { params: { title: unique(title) } });
    await expect(screen.getByTestId('issue-title')).toHaveValue(title);

    await agent.act('change this issue priority to High');
    await expect(screen.getByTestId('prop-priority')).toContainText('High');

    await agent.act('change this issue status to Todo');
    await expect(screen.getByTestId('prop-status')).toContainText('Todo');

    await app.open('/search');
    await agent.act('find the issue called {title} and open it', {
      params: { title: unique(title) },
    });
    await expect(browser).toHaveURL(/\/issue\/ENG-\d+$/);
    await expect(screen.getByTestId('issue-title')).toHaveValue(title);
    await expect(screen.getByTestId('prop-priority')).toContainText('High');
    await expect(screen.getByTestId('prop-status')).toContainText('Todo');
  },
);
