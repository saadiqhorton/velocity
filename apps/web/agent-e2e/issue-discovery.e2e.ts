import { test } from '@e2e-dev/web';
import { expect, unique } from 'e2e';

interface CreatedIssue {
  id: string;
  identifier: string;
  title: string;
}

interface GraphqlResponse {
  data?: { createIssue?: Record<string, string> };
  errors?: { message: string }[];
}

test(
  'a user discovers the correct issue among similar issues',
  { session: 'velocity-owner', requires: ['browser'], tags: ['semantic'] },
  async ({ app, agent, browser, screen }) => {
    const runId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
    const target = unique(`Authentication timeout after password reset ${runId}`);
    const decoys = [
      `Authentication redirect fails after login ${runId}`,
      `Dashboard timeout when loading ${runId}`,
      `Mobile login intermittently fails ${runId}`,
    ];

    await app.open('/settings/profile');
    await expect(screen.getByRole('main')).toBeVisible();

    const csrf = (await browser.cookies()).find((cookie) => cookie.name === 'vel_csrf')?.value ?? '';
    const created = await browser.evaluate(
      async ({ csrfToken, titles }) => {
        const response = await fetch('/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify({
            query: `mutation CreateIssue($input: CreateIssueInput!) {
              createIssue(input: $input) { id identifier title }
            }`,
            variables: { input: { teamKey: 'ENG', title: titles[0] } },
          }),
        });
        const targetResult = (await response.json()) as GraphqlResponse;
        if (targetResult.errors?.length || !targetResult.data?.createIssue) {
          return { issue: null, errors: targetResult.errors?.map(({ message }) => message) ?? ['Target issue was not created'] };
        }

        for (const title of titles.slice(1)) {
          const decoyResponse = await fetch('/graphql', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify({
              query: `mutation CreateIssue($input: CreateIssueInput!) {
                createIssue(input: $input) { id identifier title }
              }`,
              variables: { input: { teamKey: 'ENG', title } },
            }),
          });
          const decoyResult = (await decoyResponse.json()) as GraphqlResponse;
          if (decoyResult.errors?.length || !decoyResult.data?.createIssue) {
            return { issue: null, errors: decoyResult.errors?.map(({ message }) => message) ?? ['Decoy issue was not created'] };
          }
        }

        return { issue: targetResult.data.createIssue, errors: [] };
      },
      { csrfToken: csrf, titles: [target.value, ...decoys] },
    );

    const setupResult = created as { issue: CreatedIssue | null; errors: string[] };
    expect(setupResult.errors).toEqual([]);
    const issue = setupResult.issue;
    if (!issue) throw new Error('Deterministic issue setup did not return the target issue.');

    await app.open('/settings/profile');
    await agent.act('find the issue called {title} and open it', {
      params: { title: target },
    });

    await expect(browser).toHaveURL(`/issue/${issue.identifier}`);
    await expect(screen.getByTestId('issue-title')).toHaveValue(target.value);
    await expect(screen.getByTestId('issue-title')).toBeVisible();
  },
);
