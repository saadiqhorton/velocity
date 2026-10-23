import { expect, test, graphqlAs, uniqueTitle } from './support/fixtures';

test('overview milestone edits, progress diamonds, and issue drill-down persist', async ({ page, guard }, testInfo) => {
  await page.setViewportSize({ width: 1837, height: 900 });
  await page.goto('/projects');
  const data = await graphqlAs(page, 'query { teams { id key statuses { id category } } }');
  const team = (data.teams as { id: string; key: string; statuses: { id: string; category: string }[] }[]).find((item) => item.key === 'ENG')!;
  const done = team.statuses.find((item) => item.category === 'done')!.id;
  const todo = team.statuses.find((item) => item.category === 'todo')!.id;
  const created = await graphqlAs(page, 'mutation ($input: ProjectInput!) { createProject(input: $input) { id } }', { input: { name: uniqueTitle('Milestone overview'), teamIds: [team.id] } });
  const projectId = (created.createProject as { id: string }).id;
  const createMilestone = async (name: string, description: string) => {
    const result = await graphqlAs(page, 'mutation ($projectId: ID!, $input: MilestoneInput!) { createMilestone(projectId: $projectId, input: $input) { id } }', { projectId, input: { name, description } });
    return (result.createMilestone as { id: string }).id;
  };
  const foundation = await createMilestone('Foundation', 'Protect the existing workflows and establish release criteria.');
  const files = await createMilestone('File transfer reliability across platforms', 'Deliver reliable transfers and clear progress feedback.');
  for (const [title, milestoneId, statusId] of [['Completed foundation', foundation, done], ['Open foundation', foundation, todo], ['Other milestone', files, done]]) {
    await graphqlAs(page, 'mutation ($input: CreateIssueInput!) { createIssue(input: $input) { id } }', { input: { title, teamId: team.id, projectId, milestoneId, statusId } });
  }

  await page.goto(`/project/${projectId}`);
  const overview = page.getByTestId('overview-milestones');
  await expect(overview.getByTestId('overview-milestone')).toHaveCount(2);
  await expect(overview.getByText('Protect the existing workflows and establish release criteria.')).toBeVisible();
  const foundationRow = overview.getByTestId('overview-milestone').filter({ hasText: 'Foundation' });
  await expect(foundationRow.getByRole('link', { name: 'View issues in Foundation' })).toHaveText('2 issues · 50%');
  await expect(foundationRow.locator('clipPath rect')).toHaveAttribute('y', '6');

  await foundationRow.getByRole('button', { name: 'Status: Foundation, Planned' }).click();
  await page.getByRole('option', { name: 'In progress' }).click();
  await foundationRow.getByRole('button', { name: 'Description: Foundation' }).click();
  const description = foundationRow.getByRole('textbox', { name: 'Description: Foundation' });
  await description.fill('Updated release criteria.');
  await description.blur();
  await foundationRow.hover();
  await foundationRow.getByRole('button', { name: 'Target date: Foundation' }).click();
  const date = foundationRow.getByLabel('Target date: Foundation');
  await date.fill('2027-01-20');
  await date.blur();
  await page.reload();
  await expect(overview.getByRole('button', { name: 'Status: Foundation, In progress' })).toBeVisible();
  await expect(overview.getByText('Updated release criteria.')).toBeVisible();
  await expect(overview.getByRole('button', { name: 'Target date: Foundation' })).toContainText('Jan 20');
  await page.screenshot({ path: testInfo.outputPath('milestone-overview.png') });

  await overview.getByRole('link', { name: 'View issues in Foundation' }).click();
  await expect(page).toHaveURL(new RegExp(`/project/${projectId}/issues\\?milestone=${foundation}`));
  await expect(page.getByRole('tab', { name: 'Issues', selected: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear milestone filter: Foundation' })).toBeVisible();
  await expect(page.getByTestId('issue-row')).toHaveCount(2);
  await expect(page.getByTestId('issue-row').filter({ hasText: 'Other milestone' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('issue-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'New issue', exact: true }).filter({ hasText: 'New issue' }).click();
  await page.getByTestId('create-issue-title').fill('Inherited milestone');
  await page.getByTestId('create-issue-submit').click();
  await expect(page.getByTestId('issue-row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Clear milestone filter: Foundation' }).click();
  await expect(page).not.toHaveURL(/milestone=/);
  await expect(page.getByTestId('issue-row')).toHaveCount(4);

  await page.getByRole('tab', { name: 'Overview' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(overview.getByRole('link', { name: 'View issues in Foundation' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('milestone-mobile.png') });
  expect(guard.csp).toHaveLength(0);
});
