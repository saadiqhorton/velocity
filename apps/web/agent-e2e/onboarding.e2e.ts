import { test } from '@e2e-dev/web';
import { credentials, expect, unique } from 'e2e';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test(
  'a new owner sets up Velocity and reaches a first useful issue',
  { requires: ['browser'], tags: ['semantic', 'onboarding'] },
  async ({ app, agent, browser, screen }) => {
    const displayName = unique('Velocity Admin');
    const username = unique('veluser');
    const workspaceName = unique('Velocity Workspace');
    const issueTitle = unique('First Engineering Task');
    const password = credentials.user('velocity-first-owner').password;

    await app.open('/');
    await expect(browser).toHaveURL(/\/setup$/);
    await expect(screen.getByRole('heading', 'Set up your workspace')).toBeVisible();

    await agent.act(
      'Set up the first owner account for {displayName} with username {username} and password {password}.',
      {
        params: { displayName, username, password },
      },
    );
    await expect(screen.getByTestId('setup-step-workspace')).toBeVisible();
    await expect(screen.getByLabel('Workspace name')).toBeVisible();

    await agent.act('Set up a workspace named {workspaceName} for my software team.', {
      params: { workspaceName },
    });

    await expect(screen.getByTestId('setup-step-team')).toBeVisible();
    await expect(screen.getByLabel('Team name')).toHaveValue('Engineering');
    await expect(screen.getByLabel('Team key')).toHaveValue('ENG');

    await agent.act('Establish the first team for engineering work.');
    await expect(screen.getByTestId('setup-step-github')).toBeVisible();

    await agent.act('Open my new workspace so I can start tracking software work.');

    await expect(screen.getByTestId('app-shell')).toBeVisible();
    await expect(screen.getByRole('navigation', 'Primary')).toBeVisible();
    await expect(screen.getByTestId('workspace-name')).toHaveText(workspaceName.value);
    await expect(screen.getByTestId('sidebar').getByRole('button', 'Engineering')).toBeVisible();

    // The agent may explore settings after setup; start the issue journey in the team's work view.
    await app.open('/team/ENG/active');
    await expect(browser).toHaveURL('/team/ENG/active');

    await agent.act('Create my first issue called {title} for the Engineering team.', {
      params: { title: issueTitle },
    });
    const createdStatus = screen.getByRole('status').filter({ hasText: /Created ENG-\d+/ });
    await expect(createdStatus).toBeVisible();
    await expect(createdStatus).toContainText(/Created ENG-\d+/);
    const createdText = await createdStatus.textContent();
    const identifier = createdText?.match(/Created (ENG-\d+)/)?.[1];
    if (!identifier) throw new Error('The issue creation confirmation did not expose its Engineering identifier.');

    await app.open('/team/ENG/backlog');
    await expect(browser).toHaveURL('/team/ENG/backlog');
    const issueRow = screen.getByTestId('issue-row').filter({ hasText: issueTitle.value });
    await expect(issueRow).toBeVisible();
    await expect(issueRow).toHaveAttribute(
      'aria-label',
      new RegExp(`^${identifier} ${escapeRegExp(issueTitle.value)}$`),
    );

    await agent.act('Open the issue called {title}.', { params: { title: issueTitle } });
    await expect(browser).toHaveURL(`/issue/${identifier}`);
    await expect(screen.getByTestId('issue-title')).toHaveValue(issueTitle.value);
    await expect(screen.getByTestId('issue-identifier')).toHaveText(identifier);
  },
);
