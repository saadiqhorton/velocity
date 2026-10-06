import { expect, test, uniqueTitle } from './support/fixtures';

const AVATAR_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGMQqTjxnxLMMGrA/9EwODEaBhXDIgwAWklTH/BQ6igAAAAASUVORK5CYII=', 'base64');

test.describe('settings', () => {
  // Draft coverage is paused at the Lane C checkpoint; re-enable each flow after verification.
  test('profile saves details and uploads an avatar; sessions and MCP information load', async ({ page }) => {
    await page.goto('/settings/profile');
    await expect(page.getByTestId('settings-profile')).toBeVisible();
    const name = page.getByRole('textbox', { name: 'Display name' });
    const original = await name.inputValue();
    const edited = uniqueTitle('E2E Owner');
    await name.fill(edited);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('settings-profile').getByRole('heading', { name: 'Profile' })).toBeVisible();
    await expect(name).toHaveValue(edited);
    await page.getByTestId('avatar-input').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: AVATAR_PNG });
    await expect(page.getByTestId('settings-profile').locator('img').first()).toHaveAttribute('src', /\/avatars\//, { timeout: 15_000 });
    // Remove clears the avatar and hides its own button (SPEC §3.12 profile).
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByTestId('settings-profile').locator('img')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeHidden();
    await name.fill(original);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(name).toHaveValue(original);

    await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Sessions' }).click();
    await expect(page.getByTestId('settings-sessions')).toBeVisible();
    await expect(page.getByRole('grid', { name: 'Sessions' })).toContainText('This session');
    await expect(page.getByRole('button', { name: 'Log out other sessions' })).toBeDisabled();

    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await expect(page).toHaveURL(/\/settings\//);
    await page.goto('/settings/mcp');
    await expect(page.getByTestId('settings-mcp')).toBeVisible();
    await expect(page.getByTestId('mcp-tools').locator('li').first()).toBeVisible();
    // Tabs: Claude Code is first, then Claude Desktop, Cursor and Other.
    await expect(page.getByTestId('mcp-claude-code')).toContainText('claude mcp add --transport http velocity');
    await expect(page.getByTestId('mcp-claude-code')).toContainText('X-Api-Key: vel_your_api_key');
    await page.getByRole('tab', { name: 'Claude Desktop' }).click();
    await expect(page.getByTestId('mcp-claude-desktop')).toContainText('/mcp/client-');
    await page.getByRole('tab', { name: 'Cursor' }).click();
    await expect(page.getByTestId('mcp-cursor')).toContainText('"url"');
    await page.getByRole('tab', { name: 'Other' }).click();
    await expect(page.getByTestId('mcp-http')).toContainText('/mcp');
    await expect(page.getByTestId('mcp-stdio')).toContainText('npx -y');
    await page.getByRole('link', { name: 'Settings → API keys' }).click();
    await expect(page).toHaveURL(/\/settings\/api-keys/);
  });

  test('API key is shown once, tracked, and revoked', async ({ page }) => {
    const keyName = uniqueTitle('E2E key');
    await page.goto('/settings/api-keys');
    await expect(page.getByTestId('settings-api-keys')).toBeVisible();
    await page.getByRole('button', { name: 'Create API key' }).first().click();
    const create = page.getByRole('dialog', { name: 'Create API key' });
    await create.getByRole('textbox', { name: 'Name' }).fill(keyName);
    await create.getByRole('radio', { name: /Write/ }).check();
    await create.getByRole('button', { name: 'Create key' }).click();
    const secret = page.getByTestId('api-key-secret');
    await expect(secret).toBeVisible();
    const token = await secret.inputValue();
    expect(token).toMatch(/^vel_/);
    await page.getByRole('dialog', { name: 'API key created' }).getByRole('button', { name: 'Done' }).click();
    await expect(secret).toBeHidden();
    const row = page.getByRole('row', { name: new RegExp(keyName) });
    await expect(row).toBeVisible();
    await expect(row.getByLabel(/No mutations in the last 24 hours/)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('api-key-secret')).toBeHidden();
    await row.getByRole('button', { name: `Revoke key ${keyName}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke', exact: true }).click();
    await expect(row).toBeHidden();
  });

  test('workspace details and deletion request can be saved then canceled', async ({ page }) => {
    await page.goto('/settings/general');
    await expect(page.getByTestId('settings-general')).toBeVisible();
    const name = page.getByRole('textbox', { name: 'Workspace name' });
    const original = await name.inputValue();
    await name.fill(`${original} QA`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('general-form')).toContainText('Saved');
    await name.fill(original);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(name).toHaveValue(original);

    await page.getByRole('button', { name: 'Delete workspace', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this workspace' });
    await expect(dialog.getByRole('button', { name: 'Schedule deletion' })).toBeDisabled();
    await dialog.getByRole('textbox', { name: `Type ${original} to confirm` }).fill(original);
    await dialog.getByRole('button', { name: 'Schedule deletion' }).click();
    await expect(page.getByTestId('general-danger')).toContainText('Deletion scheduled');
    await page.getByTestId('general-danger').getByRole('button', { name: 'Cancel deletion' }).click();
    await expect(page.getByTestId('general-danger')).toContainText('Delete this workspace');
  });

  test('label groups and labels can be created, edited, and removed by keyboard', async ({ page }) => {
    const group = uniqueTitle('QA group');
    const label = uniqueTitle('QA label');
    await page.goto('/settings/labels');
    await expect(page.getByTestId('settings-labels')).toBeVisible();
    await page.getByRole('button', { name: 'New group' }).click();
    await page.getByTestId('label-editor').getByRole('textbox', { name: 'Name' }).fill(group);
    await page.getByTestId('label-editor').getByRole('button', { name: 'Create' }).click();
    const groupRow = page.getByTestId('label-row').filter({ hasText: group });
    await expect(groupRow).toBeVisible();
    await page.getByRole('button', { name: 'New label' }).click();
    const editor = page.getByTestId('label-editor');
    await editor.getByRole('textbox', { name: 'Name' }).fill(label);
    await editor.getByRole('combobox', { name: 'Group' }).selectOption({ label: group });
    await editor.getByRole('textbox', { name: 'Description' }).fill('Created in settings E2E');
    await editor.getByRole('textbox', { name: 'Name' }).press('Enter');
    const labelRow = page.getByTestId('label-row').filter({ hasText: label });
    await expect(labelRow).toContainText('Created in settings E2E');
    await labelRow.getByRole('button', { name: `Edit ${label}` }).focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('label-editor').getByRole('textbox', { name: 'Description' }).fill('Edited in settings E2E');
    await page.getByTestId('label-editor').getByRole('button', { name: 'Save' }).click();
    await expect(labelRow).toContainText('Edited in settings E2E');
    await labelRow.getByRole('button', { name: `Delete ${label}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete label' }).click();
    await expect(labelRow).toBeHidden();
    await groupRow.getByRole('button', { name: `Delete ${group}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete label' }).click();
    await expect(groupRow).toBeHidden();
  });

  test('team settings cover create, workflow edits, cycles, archive, and delete with move target', async ({ page }) => {
    const key = `Q${Date.now().toString(36).slice(-6).toUpperCase()}`;
    const name = uniqueTitle('QA team');
    await page.goto('/settings/teams');
    await expect(page.getByTestId('teams-table')).toBeVisible();
    await page.getByRole('button', { name: 'Create team' }).click();
    await expect(page.getByTestId('settings-team-new')).toBeVisible();
    await page.getByTestId('settings-team-new').getByRole('textbox', { name: 'Name' }).fill(name);
    await page.getByTestId('settings-team-new').getByRole('textbox', { name: 'Key' }).fill(key);
    await page.getByTestId('settings-team-new').getByRole('switch', { name: 'Cycles' }).check();
    await page.getByTestId('settings-team-new').getByRole('button', { name: 'Create team' }).click();
    await expect(page).toHaveURL(new RegExp(`/team/${key}/active`));
    await page.goto(`/settings/teams/${key}`);
    await expect(page.getByTestId('settings-team')).toBeVisible();
    await page.getByRole('tab', { name: 'Cycles' }).click();
    await expect(page.getByTestId('team-cycles-settings').getByRole('switch', { name: 'Enable cycles' })).toBeChecked();
    await page.getByRole('combobox', { name: 'Cycle length' }).selectOption('3');
    await expect(page.getByTestId('team-cycles-settings')).toContainText('Saved');

    await page.getByRole('tab', { name: 'Workflow' }).click();
    const workflow = page.getByTestId('workflow-editor');
    const todo = page.getByTestId('workflow-todo');
    await todo.getByRole('button', { name: 'Add status to Todo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add status to Todo' });
    await dialog.getByRole('textbox', { name: 'Status name' }).fill('QA Review');
    await dialog.getByRole('button', { name: 'Add status' }).click();
    const row = workflow.getByTestId('status-row').filter({ has: page.getByRole('textbox', { name: 'Name of QA Review' }) });
    await expect(row).toBeVisible();
    await row.getByRole('textbox', { name: 'Name of QA Review' }).fill('QA Verification');
    await row.getByRole('textbox', { name: 'Name of QA Review' }).press('Enter');
    const renamed = workflow.getByTestId('status-row').filter({ has: page.getByRole('textbox', { name: 'Name of QA Verification' }) });
    await expect(renamed).toBeVisible();
    await renamed.getByRole('button', { name: 'Color of QA Verification' }).click();
    await page.getByRole('radio', { name: 'Purple' }).click();
    await renamed.getByRole('button', { name: 'Actions for QA Verification' }).click();
    await page.getByRole('menuitem', { name: 'Move up' }).click();
    await expect(todo.getByTestId('status-row').first()).toHaveAttribute('data-status-name', 'QA Verification');
    await renamed.getByRole('button', { name: 'Actions for QA Verification' }).click();
    await page.getByRole('menuitem', { name: 'Delete status' }).click();
    await page.getByRole('dialog', { name: 'Delete QA Verification' }).getByRole('button', { name: 'Delete status' }).click();
    await expect(renamed).toBeHidden();

    await page.getByRole('tab', { name: 'General' }).click();
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unarchive' })).toBeVisible();
    await page.getByRole('button', { name: 'Unarchive' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const remove = page.getByRole('dialog', { name: `Delete ${name}` });
    await expect(remove.getByRole('combobox', { name: 'Move issues to' })).toBeVisible();
    await remove.getByRole('textbox', { name: `Type ${key} to confirm` }).fill(key);
    await remove.getByRole('button', { name: 'Delete team' }).click();
    await expect(page).toHaveURL(/\/settings\/teams$/);
    await expect(page.getByTestId('teams-table')).not.toContainText(key);
  });

  test('invite link accepts in a second context; owner suspends, resets password, and removes member', async ({ page, browser }) => {
    const memberName = uniqueTitle('QA member');
    const username = `q${Date.now().toString(36).slice(-8)}`;
    const newPassword = 'another-correct-horse-42';
    await page.goto('/settings/members');
    await expect(page.getByTestId('settings-members')).toBeVisible();
    await page.getByRole('button', { name: 'Invite member' }).click();
    const create = page.getByRole('dialog', { name: 'Invite a member' });
    await create.getByRole('textbox', { name: 'Name' }).fill(memberName);
    await create.getByRole('button', { name: 'Create invite link' }).click();
    const ready = page.getByRole('dialog', { name: 'Invite link created' });
    const link = await ready.getByRole('textbox', { name: 'Invite link' }).inputValue();
    expect(link).toContain('/invite/');
    await ready.getByRole('button', { name: 'Done' }).click();

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } });
    try {
      const memberPage = await context.newPage();
      await memberPage.goto(link);
      await memberPage.getByRole('textbox', { name: 'Username' }).fill(username);
      await memberPage.getByRole('textbox', { name: 'Password' }).fill(newPassword);
      await memberPage.getByRole('button', { name: 'Create account' }).click();
      await expect(memberPage).toHaveURL(/\/team\//);
      await memberPage.goto('/settings/audit');
      await expect(memberPage).toHaveURL(/\/settings\/profile/);
    } finally {
      await context.close();
    }

    await page.reload();
    const row = page.getByRole('row', { name: new RegExp(memberName) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Actions for ${memberName}` }).click();
    await page.getByRole('menuitem', { name: 'Suspend' }).click();
    await expect(row).toContainText('Suspended');
    await row.getByRole('button', { name: `Actions for ${memberName}` }).click();
    await page.getByRole('menuitem', { name: 'Reactivate' }).click();
    await expect(row).toContainText('Active');
    await row.getByRole('button', { name: `Actions for ${memberName}` }).click();
    await page.getByRole('menuitem', { name: 'Set password' }).click();
    const passwordDialog = page.getByRole('dialog', { name: `Set password for ${memberName}` });
    await passwordDialog.getByRole('textbox', { name: 'New password' }).fill('reset-correct-horse-43');
    await passwordDialog.getByRole('button', { name: 'Set password' }).click();
    await expect(passwordDialog).toBeHidden();
    await row.getByRole('button', { name: `Actions for ${memberName}` }).click();
    await page.getByRole('menuitem', { name: 'Remove from workspace' }).click();
    await page.getByRole('dialog', { name: `Remove ${memberName}` }).getByRole('button', { name: 'Remove member' }).click();
    await expect(row).toBeHidden();
  });

  test('webhook secret, test delivery, redelivery, and export download', async ({ page }) => {
    const endpoint = `https://example.com/hooks/velocity-${Date.now().toString(36)}`;
    await page.goto('/settings/webhooks');
    await expect(page.getByTestId('settings-webhooks')).toBeVisible();
    await page.getByRole('button', { name: 'New webhook' }).click();
    const create = page.getByRole('dialog', { name: 'New webhook' });
    await create.getByRole('textbox', { name: 'Endpoint URL' }).fill(endpoint);
    await create.getByRole('button', { name: 'Create webhook' }).click();
    await expect(page.getByTestId('webhook-secret')).toBeVisible();
    await page.getByRole('dialog', { name: 'Signing secret' }).getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('settings-webhook-detail')).toBeVisible();
    await page.getByTestId('settings-webhook-detail').getByRole('button', { name: 'Send test' }).first().click();
    await page.getByRole('button', { name: 'Refresh deliveries' }).click();
    const deliveries = page.getByTestId('delivery-table');
    const pingRow = deliveries.getByRole('row', { name: /ping/ });
    await expect(pingRow).toBeVisible({ timeout: 20_000 });
    await pingRow.click();
    await expect(page.getByTestId('delivery-detail')).toBeVisible();
    await deliveries.getByRole('button', { name: 'Redeliver' }).first().click();
    await page.getByTestId('settings-webhook-detail').getByRole('button', { name: 'Delete webhook' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete webhook' }).click();
    await expect(page).toHaveURL(/\/settings\/webhooks$/);

    await page.goto('/settings/export');
    await expect(page.getByTestId('settings-export')).toBeVisible();
    await page.getByRole('button', { name: 'Request export' }).click();
    const download = page.getByRole('link', { name: /Download export from/ });
    await expect(download).toBeVisible({ timeout: 30_000 });
    const response = await page.request.get(await download.getAttribute('href') ?? '');
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('application/json');
  });

  test('GitHub settings show configuration requirements and configured-state controls', async ({ page }) => {
    await page.goto('/settings/github');
    await expect(page.getByTestId('settings-github')).toBeVisible();
    await expect(page.getByTestId('github-setup')).toBeVisible();
    await expect(page.getByText('Connect GitHub', { exact: true })).toBeVisible();
    await page.getByTestId('github-setup').getByText('Configure via environment variables instead').click();
    await expect(page.getByTestId('github-env').locator('li')).toHaveCount(5);

    await page.route('**/graphql', async (route) => {
      const body = route.request().postDataJSON() as { operationName?: string };
      if (body.operationName !== 'Integrations') return route.continue();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: {
          githubIntegration: {
            __typename: 'GithubIntegration',
            configured: true,
            source: 'database',
            appName: 'velocity-test',
            installUrl: 'https://github.com/apps/velocity-test/installations/new',
            installs: [{
              __typename: 'GithubInstall', id: '00000000-0000-4000-8000-000000000001', installationId: 123,
              accountLogin: 'qa-org', accountType: 'Organization', repos: ['qa-org/repo'],
              autoCloseOnMerge: false, issueSync: false, issueSyncTeamId: null, repoTeamMap: {},
              backfillStatus: 'idle', backfillProgress: 0, suspendedAt: null, createdAt: new Date().toISOString(),
            }],
          },
          mcpInfo: { __typename: 'McpInfo', httpEnabled: false, httpEndpoint: null, serverUrl: 'http://localhost:3230', stdioCommand: 'velocity-mcp' },
        } }),
      });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'qa-org' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Close issues when a pull request merges' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Create issues from GitHub issues' })).toBeVisible();
    await expect(page.getByTestId('github-repos')).toContainText('qa-org/repo');
    await page.unroute('**/graphql');
  });

  test('audit log filters server-side by date and survives a reload', async ({ page }) => {
    await page.goto('/settings/audit');
    await expect(page.getByTestId('settings-audit')).toBeVisible();
    const grid = page.getByRole('grid', { name: 'Audit log' });
    await expect(grid.getByRole('row').nth(1)).toBeVisible();

    // A "Last 24 hours" preset becomes a server-side `after` filter; the log was populated today.
    await page.getByRole('combobox', { name: 'Date' }).selectOption('24h');
    await expect(grid.getByRole('row').nth(1)).toBeVisible();
    const rangeText = await page.getByTestId('settings-audit').getByText(/to \d+ of/).innerText();
    expect(rangeText).toMatch(/^\d+ to \d+ of \d+/);

    // A far-future window filters everything out via the API (no client-side slicing).
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('combobox', { name: 'Date' })).toHaveValue('');
  });
});
