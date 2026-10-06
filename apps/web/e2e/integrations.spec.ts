// Release E2E: exercise cycle carry-over and GitHub's signed webhook queue through the real API.
import { createHmac, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, graphqlAs, test, uniqueTitle } from './support/fixtures';
import { E2E_GITHUB_WEBHOOK_SECRET } from './support/env.mjs';

interface Cycle {
  id: string;
  name: string;
  number: number;
  isActive: boolean;
  closedAt: string | null;
  stats: { carriedOverCount: number } | null;
}

async function cyclesFor(page: Page, teamId: string): Promise<Cycle[]> {
  const data = await graphqlAs(page, `query ($teamId: ID!) {
    cycles(teamId: $teamId, includeClosed: true) {
      id name number isActive closedAt stats { carriedOverCount }
    }
  }`, { teamId });
  return data.cycles as Cycle[];
}

test('manual API cycle close opens the next cycle and carries an incomplete issue into the UI', async ({ page }) => {
  const key = `C${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const title = uniqueTitle('Carry over');
  const created = await graphqlAs(page, `mutation ($input: CreateTeamInput!) {
    createTeam(input: $input) { id key }
  }`, { input: { key, name: `Cycle rotation ${key}`, cycleEnabled: true, carryOver: 'next_cycle' } });
  const team = created.createTeam as { id: string; key: string };
  await graphqlAs(page, 'mutation ($teamId: ID!) { rotateCycles(teamId: $teamId) }', { teamId: team.id });
  const before = await cyclesFor(page, team.id);
  const current = before.find((c) => c.isActive && !c.closedAt);
  expect(current, 'rotation should create an active cycle').toBeDefined();
  const issueData = await graphqlAs(page, `mutation ($input: CreateIssueInput!) {
    createIssue(input: $input) { id identifier title cycleId }
  }`, { input: { teamId: team.id, cycleId: current!.id, title } });
  const issue = issueData.createIssue as { id: string; identifier: string; cycleId: string };
  expect(issue.cycleId).toBe(current!.id);

  await page.goto(`/team/${team.key}/cycles`);
  await expect(page.getByTestId('cycle-header')).toContainText(current!.name);
  await expect(page.getByTestId('issue-row').filter({ hasText: title })).toBeVisible();

  const close = await graphqlAs(page, `mutation ($id: ID!) {
    closeCycle(id: $id) { id closedAt stats { carriedOverCount } }
  }`, { id: current!.id });
  expect((close.closeCycle as Cycle).stats?.carriedOverCount).toBe(1);
  const after = await cyclesFor(page, team.id);
  const next = after.find((c) => c.isActive && !c.closedAt);
  expect(next?.number).toBe(current!.number + 1);

  await page.reload();
  await expect(page.getByTestId('cycle-header')).toContainText(next!.name);
  await expect(page.getByTestId('issue-row').filter({ hasText: title })).toBeVisible();
  await page.goto(`/team/${team.key}/cycles/${current!.id}`);
  await expect(page.getByTestId('cycle-header')).toContainText('1 carried over');
  const moved = await graphqlAs(page, 'query ($id: ID!) { issue(id: $id) { cycleId } }', { id: issue.id });
  expect((moved.issue as { cycleId: string }).cycleId).toBe(next!.id);
});

interface GithubIssue {
  status: { category: string };
  githubLinks: { repo: string; prNumber: number; state: string; mergedAt: string | null; closesIssue: boolean }[];
  activity: { type: string }[];
}

async function githubIssue(page: Page, id: string): Promise<GithubIssue> {
  const data = await graphqlAs(page, `query ($id: ID!) {
    issue(id: $id) {
      status { category }
      githubLinks { repo prNumber state mergedAt closesIssue }
      activity { type }
    }
  }`, { id });
  return data.issue as GithubIssue;
}

async function sendPullWebhook(page: Page, action: 'opened' | 'closed', identifier: string, number: number): Promise<void> {
  const merged = action === 'closed';
  const rawBody = JSON.stringify({
    action,
    repository: { full_name: 'qa-org/e2e-repo' },
    pull_request: {
      number,
      title: `Fixes ${identifier}: complete webhook E2E`,
      body: `Fixes ${identifier}`,
      html_url: `https://github.com/qa-org/e2e-repo/pull/${number}`,
      state: merged ? 'closed' : 'open',
      merged,
      merged_at: merged ? new Date().toISOString() : null,
      closed_at: merged ? new Date().toISOString() : null,
      head: { ref: `fix/${identifier.toLowerCase()}` },
      user: { login: 'e2e-contributor' },
    },
  });
  const signature = `sha256=${createHmac('sha256', E2E_GITHUB_WEBHOOK_SECRET).update(rawBody).digest('hex')}`;
  const response = await page.request.post('/api/github/webhook', {
    data: rawBody,
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': randomUUID(),
      'x-github-event': 'pull_request',
      'x-hub-signature-256': signature,
    },
  });
  expect(response.status(), await response.text()).toBe(202);
  expect((await response.json() as { status: string }).status).toBe('accepted');
}

test('signed PR opened webhook links the issue and merge closes it', async ({ page }) => {
  const title = uniqueTitle('GitHub webhook');
  const created = await graphqlAs(page, `mutation ($input: CreateIssueInput!) {
    createIssue(input: $input) { id identifier }
  }`, { input: { teamKey: 'ENG', title } });
  const issue = created.createIssue as { id: string; identifier: string };
  const prNumber = Math.floor(Math.random() * 900_000) + 100_000;
  await sendPullWebhook(page, 'opened', issue.identifier, prNumber);
  await expect.poll(async () => (await githubIssue(page, issue.id)).githubLinks.length, { timeout: 15_000 }).toBe(1);
  const linked = await githubIssue(page, issue.id);
  expect(linked.githubLinks[0]).toMatchObject({ repo: 'qa-org/e2e-repo', prNumber, state: 'open', closesIssue: true });
  expect(linked.activity.some((entry) => entry.type === 'github_pr')).toBe(true);
  expect(linked.status.category).not.toBe('done');

  await page.goto(`/issue/${issue.identifier}`);
  await expect(page.getByTestId('issue-title')).toHaveValue(title);
  // The issue page lists linked pull requests in its main column (U1); the panel keeps a GitHub tab.
  await expect(page.getByTestId('github-links')).toContainText(`e2e-repo#${prNumber}`);
  await expect(page.getByTestId('github-links')).toContainText('Open');

  await sendPullWebhook(page, 'closed', issue.identifier, prNumber);
  await expect.poll(async () => (await githubIssue(page, issue.id)).status.category, { timeout: 15_000 }).toBe('done');
  await page.reload();
  await expect(page.getByTestId('prop-status')).toContainText('Done');
  await expect(page.getByTestId('github-links')).toContainText('Merged');
  expect((await githubIssue(page, issue.id)).githubLinks[0]?.mergedAt).toBeTruthy();
});

// github.com is unreachable in tests: the manifest POST is intercepted and fulfilled locally.
test('owner sees GitHub setup and the manifest form posts to github.com with state', async ({ page }) => {
  let posted: { url: string; body: string } | null = null;
  await page.route('https://github.com/**', async (route) => {
    const req = route.request();
    posted = { url: req.url(), body: req.postData() ?? '' };
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>github stub</body></html>' });
  });
  await page.goto('/settings/github');
  await expect(page.getByTestId('github-setup')).toBeVisible();
  await page.getByTestId('github-setup-org').fill('qa-org');
  await page.getByTestId('github-setup-button').click();
  await expect.poll(() => posted, { timeout: 15_000 }).not.toBeNull();
  const { url, body } = posted as unknown as { url: string; body: string };
  expect(url).toMatch(/^https:\/\/github\.com\/organizations\/qa-org\/settings\/apps\/new\?state=.+/);
  const manifest = JSON.parse(new URLSearchParams(body).get('manifest') ?? '{}') as Record<string, unknown>;
  expect(manifest).toMatchObject({
    name: 'Velocity',
    public: false,
    default_permissions: { issues: 'write', pull_requests: 'read', metadata: 'read' },
  });
  expect(String(manifest.redirect_url)).toMatch(/\/settings\/github$/);
});

test('invalid manifest code on return from GitHub shows an error and strips the params', async ({ page }) => {
  await page.goto('/settings/github?code=bogus&state=bogus');
  await expect(page.getByText('The setup link is invalid or expired. Start the setup again.')).toBeVisible();
  await expect(page).not.toHaveURL(/code=|state=/);
  await expect(page.getByTestId('github-setup')).toBeVisible();
});
// Removing a stored App needs real GitHub credentials (a manifest conversion), so it is not covered here.
