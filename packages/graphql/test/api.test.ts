import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, apiActor, createHarness, executeApi, setupOwner } from './helpers';
import type { ApiResult } from './helpers';
import type { ServiceActor } from '../../services/src/index';
import type { Harness } from '../../services/test/helpers/harness';

const CREATE_ISSUE = `mutation CreateIssue($input: CreateIssueInput!) {
  createIssue(input: $input) { id identifier title priority }
}`;

const ISSUE_LIST = `query Issues($filter: String, $teamId: ID, $teamKey: String, $ordering: Ordering, $first: Int, $after: String) {
  issues(filter: $filter, teamId: $teamId, teamKey: $teamKey, ordering: $ordering, first: $first, after: $after) {
    nodes { id identifier title priority }
    totalCount
    pageInfo { endCursor hasNextPage }
  }
}`;

function payload(result: ApiResult, field: string): Record<string, unknown> {
  expect(result.errors).toEqual([]);
  return result.data?.[field] as Record<string, unknown>;
}

function errorCode(result: ApiResult): unknown {
  return result.errors[0]?.extensions.code;
}

let h: Harness;
let owner: ServiceActor;
let member: ServiceActor;
let teamId: string;
let issueId: string;
let issueIdentifier: string;

beforeAll(async () => {
  h = await createHarness();
  owner = await setupOwner(h, 'graphql-owner');
  member = await addMember(h, owner, 'graphql-member');
  const team = await h.services.teams.create(owner, { key: 'API', name: 'API team' });
  teamId = team.id;
  const created = await h.services.issues.create(owner, { teamId, title: 'Alpha first', priority: 0 });
  issueId = created.id;
  issueIdentifier = `API-${created.number}`;
  await h.services.issues.create(owner, { teamId, title: 'Alpha second', priority: 1 });
  await h.services.issues.create(owner, { teamId, title: 'Beta third', priority: 2 });
  await h.services.issues.create(owner, { teamId, title: 'Gamma fourth', priority: 3 });
});

afterAll(async () => h.close());

describe('issue list API', () => {
  it('resolves an identifier written before a team-key rename', async () => {
    const team = await h.services.teams.create(owner, { key: 'OLDAPI', name: 'Old API team' });
    const issue = await h.services.issues.create(owner, { teamId: team.id, title: 'Keep API link' });
    await h.services.teams.update(owner, team.id, { key: 'NEWAPI' });
    const oldIdentifier = `OLDAPI-${issue.number}`;
    const result = await executeApi(h, member, 'query OldIssue($identifier: String!) { issueByIdentifier(identifier: $identifier) { id identifier } }', { identifier: oldIdentifier });
    expect(payload(result, 'issueByIdentifier')).toMatchObject({ id: issue.id, identifier: `NEWAPI-${issue.number}` });
  });

  it('combines team, DSL filtering, ordering, and cursor pagination', async () => {
    const first = await executeApi(h, member, ISSUE_LIST, {
      teamKey: 'API', filter: 'title contains:"Alpha"', ordering: 'priority', first: 1,
    });
    const firstList = payload(first, 'issues');
    const firstNodes = firstList.nodes as { id: string; title: string; priority: number }[];
    const firstPageInfo = firstList.pageInfo as { endCursor: string; hasNextPage: boolean };
    expect(firstList.totalCount).toBe(2);
    expect(firstNodes.map((node) => node.title)).toEqual(['Alpha first']);
    expect(firstPageInfo.hasNextPage).toBe(true);
    expect(firstPageInfo.endCursor).toBeTruthy();

    const second = await executeApi(h, member, ISSUE_LIST, {
      teamId, filter: 'title contains:"Alpha"', ordering: 'priority', first: 1, after: firstPageInfo.endCursor,
    });
    const secondList = payload(second, 'issues');
    const secondNodes = secondList.nodes as { id: string; title: string; priority: number }[];
    const secondPageInfo = secondList.pageInfo as { endCursor: string | null; hasNextPage: boolean };
    expect(secondList.totalCount).toBe(2);
    expect(secondNodes.map((node) => node.title)).toEqual(['Alpha second']);
    expect(secondPageInfo.hasNextPage).toBe(false);
    expect(secondNodes[0]?.id).not.toBe(firstNodes[0]?.id);
  });

  it('combines ID scope, DSL predicate, orderBy, and first/after pagination', async () => {
    const first = await executeApi(h, member, ISSUE_LIST, {
      teamId, filter: 'priority gte:1 and priority lte:3', ordering: 'priority', first: 2,
    });
    const firstList = payload(first, 'issues');
    const firstNodes = firstList.nodes as { title: string; priority: number }[];
    const cursor = (firstList.pageInfo as { endCursor: string }).endCursor;
    expect(firstNodes.map((node) => node.priority)).toEqual([1, 2]);
    expect((firstList.pageInfo as { hasNextPage: boolean }).hasNextPage).toBe(true);

    const next = await executeApi(h, member, ISSUE_LIST, {
      teamId, filter: 'priority gte:1 and priority lte:3', ordering: 'priority', first: 2, after: cursor,
    });
    const nextList = payload(next, 'issues');
    expect((nextList.nodes as { priority: number }[]).map((node) => node.priority)).toEqual([3]);
    expect((nextList.pageInfo as { hasNextPage: boolean }).hasNextPage).toBe(false);
  });
});

describe('typed GraphQL errors', () => {
  it('maps bad filters to VALIDATION with DSL location details', async () => {
    const result = await executeApi(h, member, ISSUE_LIST, { teamId, filter: 'notAField:thing', first: 5 });
    expect(errorCode(result)).toBe('VALIDATION');
    expect(result.errors[0]?.extensions.position).toEqual(expect.any(Number));
    expect(result.errors[0]?.extensions.caret).toEqual(expect.any(String));
  });

  it('returns NOT_FOUND for an unknown team key', async () => {
    const result = await executeApi(h, member, ISSUE_LIST, { teamKey: 'MISSING', first: 5 });
    expect(errorCode(result)).toBe('NOT_FOUND');
  });

  it('returns CONFLICT when optimistic concurrency timestamps are stale', async () => {
    const result = await executeApi(h, member, `mutation {
      updateIssue(id: "${issueId}", expectedUpdatedAt: "2000-01-01T00:00:00.000Z", input: { title: "stale write" }) { id }
    }`);
    expect(errorCode(result)).toBe('CONFLICT');
  });

  it('returns UNAUTHENTICATED for protected queries and writes', async () => {
    const query = await executeApi(h, null, ISSUE_LIST, { teamId, first: 1 });
    expect(errorCode(query)).toBe('UNAUTHENTICATED');
    const mutation = await executeApi(h, null, CREATE_ISSUE, { input: { teamId, title: 'anonymous' } });
    expect(errorCode(mutation)).toBe('UNAUTHENTICATED');
  });

  it('returns RATE_LIMITED after repeated failed API login attempts', async () => {
    const login = 'mutation { login(input: { login: "rate-limited-api-user", password: "wrong-password-123" }) { user { id } } }';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(errorCode(await executeApi(h, null, login))).toBe('UNAUTHENTICATED');
    }
    const limited = await executeApi(h, null, login);
    expect(errorCode(limited)).toBe('RATE_LIMITED');
    expect(limited.errors[0]?.extensions.retryAfter).toEqual(expect.any(Number));
  });
});

describe('API permission truth table', () => {
  it('stores coding tools for the viewer without exposing them on other members', async () => {
    const query = 'query { viewer { id preferences { codingTools { id preset name kind template enabled shortcut } promptInstructions } } }';
    const mutation = 'mutation SavePreferences($input: UpdatePreferencesInput!) { updatePreferences(input: $input) { codingTools { id preset name kind template enabled shortcut } promptInstructions } }';
    expect((payload(await executeApi(h, member, query), 'viewer')).preferences).toBeNull();
    const input = {
      codingTools: [{ id: 'codex', preset: 'codex', name: 'Codex', kind: 'deeplink', template: 'codex://new?prompt={prompt}', enabled: true, shortcut: 'mod+alt+.' }],
      promptInstructions: 'Use tests',
    };
    expect(errorCode(await executeApi(h, apiActor(member, 'read'), mutation, { input }))).toBe('FORBIDDEN');
    expect(errorCode(await executeApi(h, null, mutation, { input }))).toBe('UNAUTHENTICATED');
    expect(errorCode(await executeApi(h, member, mutation, { input: { ...input, codingTools: [{ ...input.codingTools[0], template: 'javascript:{prompt}' }] } }))).toBe('VALIDATION');
    const saved = payload(await executeApi(h, member, mutation, { input }), 'updatePreferences');
    expect(saved).toEqual({ codingTools: [{ ...input.codingTools[0] }], promptInstructions: input.promptInstructions });
    expect(payload(await executeApi(h, member, query), 'viewer').preferences).toEqual(saved);
    expect(payload(await executeApi(h, owner, query), 'viewer').preferences).toBeNull();
    const members = payload(await executeApi(h, owner, 'query { users { id preferences { promptInstructions } } }'), 'users') as unknown as { id: string; preferences: unknown }[];
    expect(members.find((u) => u.id === member.userId)?.preferences).toBeNull();
  });

  it('exposes solo flags and permits only the owner to update them', async () => {
    const query = 'query { workspace { features { cycles estimates insights members solo } } }';
    expect(payload(await executeApi(h, member, query), 'workspace').features).toEqual({
      cycles: false, estimates: false, insights: false, members: false, solo: true,
    });
    const mutation = 'mutation SetFeatures($input: WorkspaceFeaturesInput!) { updateWorkspaceFeatures(input: $input) { features { cycles estimates insights members solo } } }';
    const input = { cycles: true, estimates: true };
    for (const actor of [member, apiActor(member, 'write'), apiActor(owner, 'read')]) {
      expect(errorCode(await executeApi(h, actor, mutation, { input }))).toBe('FORBIDDEN');
    }
    expect(errorCode(await executeApi(h, null, mutation, { input }))).toBe('UNAUTHENTICATED');
    expect(errorCode(await executeApi(h, owner, mutation, { input: {} }))).toBe('VALIDATION');
    expect(errorCode(await executeApi(h, owner, mutation, { input: { cycles: null } }))).toBe('VALIDATION');
    const changed = payload(await executeApi(h, owner, mutation, { input }), 'updateWorkspaceFeatures');
    expect(changed.features).toEqual({ cycles: true, estimates: true, insights: false, members: false, solo: false });
    expect(payload(await executeApi(h, member, query), 'workspace').features).toEqual(changed.features);
    await executeApi(h, owner, mutation, { input: { cycles: false, estimates: false } });
  });

  it('allows owner and member sessions to read and write issues, with owner-only operations guarded', async () => {
    for (const actor of [owner, member]) {
      const query = await executeApi(h, actor, ISSUE_LIST, { teamId, first: 1 });
      expect(errorCode(query)).toBeUndefined();
      const mutation = await executeApi(h, actor, CREATE_ISSUE, { input: { teamId, title: `Session write ${actor.userId}` } });
      expect(errorCode(mutation)).toBeUndefined();
      const invite = await executeApi(h, actor, 'mutation { createInvite(name: "temporary") { id } }');
      expect(errorCode(invite)).toBe(actor.isOwner ? undefined : 'FORBIDDEN');
    }
  });

  it('allows read keys to query issues but blocks issue writes and owner-only operations', async () => {
    const readKey = apiActor(member, 'read');
    expect(errorCode(await executeApi(h, readKey, ISSUE_LIST, { teamId, first: 1 }))).toBeUndefined();
    expect(errorCode(await executeApi(h, readKey, CREATE_ISSUE, { input: { teamId, title: 'read key write' } }))).toBe('FORBIDDEN');
    expect(errorCode(await executeApi(h, readKey, 'mutation { createInvite(name: "temporary") { id } }'))).toBe('FORBIDDEN');
  });

  it('allows write keys to query and write issues but keeps owner-only operations forbidden', async () => {
    const writeKey = apiActor(member, 'write');
    expect(errorCode(await executeApi(h, writeKey, ISSUE_LIST, { teamId, first: 1 }))).toBeUndefined();
    expect(errorCode(await executeApi(h, writeKey, CREATE_ISSUE, { input: { teamId, title: 'write key write' } }))).toBeUndefined();
    expect(errorCode(await executeApi(h, writeKey, 'mutation { createInvite(name: "temporary") { id } }'))).toBe('FORBIDDEN');
  });

  it('applies member permissions across team, project, cycle, view, and personal API-key writes', async () => {
    const readKey = apiActor(member, 'read');
    const writeKey = apiActor(member, 'write');
    let serial = 0;
    const memberWrites: { operation(actor: ServiceActor): string; allowedCode?: string }[] = [
      { operation: (actor) => `mutation { createTeam(input: { key: "T${serial++}", name: "Team ${actor.userId}" }) { id } }` },
      { operation: () => `mutation { createProject(input: { name: "Project ${serial++}" }) { id } }` },
      { operation: () => `mutation { renameCycle(id: "00000000-0000-7000-8000-000000000001", name: "renamed") { id } }`, allowedCode: 'NOT_FOUND' },
      { operation: () => `mutation { createView(input: { name: "View ${serial++}", filter: "priority gte:0", teamId: "${teamId}" }) { id } }` },
    ];
    for (const { operation, allowedCode } of memberWrites) {
      for (const actor of [owner, member, writeKey]) expect(errorCode(await executeApi(h, actor, operation(actor)))).toBe(allowedCode);
      expect(errorCode(await executeApi(h, readKey, operation(readKey)))).toBe('FORBIDDEN');
    }

    // Keys are personal resources and can only be created by an interactive session.
    const createOwnKey = (name: string) => `mutation { createApiKey(name: "${name}", scope: read) { apiKey { id } } }`;
    expect(errorCode(await executeApi(h, owner, createOwnKey('owner-created-key')))).toBeUndefined();
    expect(errorCode(await executeApi(h, member, createOwnKey('member-created-key')))).toBeUndefined();
    expect(errorCode(await executeApi(h, writeKey, createOwnKey('key-from-api')))).toBe('VALIDATION');
    expect(errorCode(await executeApi(h, readKey, createOwnKey('key-from-read-api')))).toBe('FORBIDDEN');

    // closeCycle has its own permission separate from cycle.write; an unknown ID lets
    // permitted actors pass the guard and reach the typed NOT_FOUND result.
    const closeMissingCycle = 'mutation { closeCycle(id: "00000000-0000-7000-8000-000000000001") { id } }';
    for (const actor of [owner, member, writeKey]) expect(errorCode(await executeApi(h, actor, closeMissingCycle))).toBe('NOT_FOUND');
    expect(errorCode(await executeApi(h, readKey, closeMissingCycle))).toBe('FORBIDDEN');
  });

  it('covers owner-only workspace, integration, import/export, deletion, audit, and key administration', async () => {
    const memberRead = apiActor(member, 'read');
    const memberWrite = apiActor(member, 'write');
    const ownerWrite = apiActor(owner, 'write');
    const memberKey = await h.services.apiKeys.create(member, { name: 'member-key-for-permissions', scope: 'write' });

    const ownerOnly: { document: string; permitted: ServiceActor[]; allowedCode?: string }[] = [
      { document: 'mutation { createInvite(name: "owner-only") { id } }', permitted: [owner, ownerWrite] },
      { document: `mutation { updateWorkspace(input: { name: "Acme" }) { name } }`, permitted: [owner, ownerWrite] },
      { document: 'mutation { uninstallGithub(installId: "00000000-0000-7000-8000-000000000001") }', permitted: [owner, ownerWrite], allowedCode: 'NOT_FOUND' },
      { document: 'query { webhooks { id } }', permitted: [owner, ownerWrite] },
      { document: 'mutation { requestExport { id } }', permitted: [owner, ownerWrite] },
      { document: 'query { auditLog { totalCount } }', permitted: [owner, ownerWrite] },
      { document: `mutation { requestWorkspaceDeletion(confirmName: "Acme") { name } }`, permitted: [owner] },
      { document: `mutation { setMemberSuspended(userId: "${member.userId}", suspended: true) { id } }`, permitted: [owner, ownerWrite] },
    ];
    for (const { document, permitted, allowedCode } of ownerOnly) {
      for (const actor of [member, memberWrite, memberRead, ownerReadActor(owner)]) {
        expect(errorCode(await executeApi(h, actor, document))).toBe('FORBIDDEN');
      }
      for (const actor of permitted) expect(errorCode(await executeApi(h, actor, document))).toBe(allowedCode);
      if (document.includes('requestWorkspaceDeletion')) {
        expect(errorCode(await executeApi(h, owner, 'mutation { cancelWorkspaceDeletion { name } }'))).toBeUndefined();
      }
      if (document.includes('setMemberSuspended')) {
        await h.services.users.setSuspended(owner, member.userId, false);
      }
    }

    // Own-key management is a member permission; revoking another member's key is owner-only.
    expect(errorCode(await executeApi(h, member, `mutation { revokeApiKey(id: "${memberKey.apiKey.id}") }`))).toBeUndefined();
    const crossMemberKey = await h.services.apiKeys.create(member, { name: 'cross-member-revoke', scope: 'write' });
    expect(errorCode(await executeApi(h, memberRead, `mutation { revokeApiKey(id: "${crossMemberKey.apiKey.id}") }`))).toBe('FORBIDDEN');
    expect(errorCode(await executeApi(h, memberWrite, `mutation { revokeApiKey(id: "${crossMemberKey.apiKey.id}") }`))).toBeUndefined();
    const memberKeyForOwner = await h.services.apiKeys.create(member, { name: 'owner-revokes-member', scope: 'write' });
    expect(errorCode(await executeApi(h, member, `mutation { revokeApiKey(id: "${memberKeyForOwner.apiKey.id}") }`))).toBeUndefined();
    const memberKeyForOwner2 = await h.services.apiKeys.create(member, { name: 'owner-revokes-member-two', scope: 'write' });
    expect(errorCode(await executeApi(h, memberRead, `mutation { revokeApiKey(id: "${memberKeyForOwner2.apiKey.id}") }`))).toBe('FORBIDDEN');
    expect(errorCode(await executeApi(h, owner, `mutation { revokeApiKey(id: "${memberKeyForOwner2.apiKey.id}") }`))).toBeUndefined();

    const ownerAll = await executeApi(h, owner, 'query { apiKeys(all: true) { user { id } } }');
    const memberAll = await executeApi(h, member, 'query { apiKeys(all: true) { user { id } } }');
    expect((payload(ownerAll, 'apiKeys') as unknown as { user: { id: string } }[]).some((key) => key.user.id === member.userId)).toBe(true);
    expect((payload(memberAll, 'apiKeys') as unknown as { user: { id: string } }[]).every((key) => key.user.id === member.userId)).toBe(true);
  });

  it('rejects read-scoped and suspended actors on profile writes and self-removal', async () => {
    const readMember = apiActor(member, 'read');
    expect(errorCode(await executeApi(h, readMember, 'mutation { updateProfile(input: { name: "Read key changed profile" }) { id } }'))).toBe('FORBIDDEN');
    const suspendedMember = { ...member, suspended: true };
    expect(errorCode(await executeApi(h, suspendedMember, ISSUE_LIST, { teamId, first: 1 }))).toBe('FORBIDDEN');
    expect(errorCode(await executeApi(h, suspendedMember, CREATE_ISSUE, { input: { teamId, title: 'suspended write' } }))).toBe('FORBIDDEN');
    expect(errorCode(await executeApi(h, suspendedMember, 'mutation { createInvite(name: "suspended invite") { id } }'))).toBe('FORBIDDEN');
    expect(errorCode(await executeApi(h, suspendedMember, 'mutation { updateProfile(input: { name: "Suspended changed profile" }) { id } }'))).toBe('FORBIDDEN');

    const disposable = await addMember(h, owner, 'graphql-disposable');
    const disposableReadKey = apiActor(disposable, 'read');
    expect(errorCode(await executeApi(h, disposableReadKey, `mutation { removeMember(userId: "${disposable.userId}") }`))).toBe('FORBIDDEN');
  });

  it('resolves issues by UUID and human identifier through the public API', async () => {
    for (const id of [issueId, issueIdentifier]) {
      const result = await executeApi(h, member, `query { issue(id: "${id}") { id identifier title } }`);
      const issue = payload(result, 'issue');
      expect(issue.id).toBe(issueId);
      expect(issue.identifier).toBe(issueIdentifier);
    }
  });

  it('filters the audit log by date range server-side', async () => {
    const AUDIT = `query Audit($after: DateTime, $before: DateTime) {
      auditLog(after: $after, before: $before, first: 200) { totalCount nodes { id createdAt } }
    }`;
    const all = await executeApi(h, owner, AUDIT, {});
    const allCount = (payload(all, 'auditLog') as { totalCount: number }).totalCount;
    expect(allCount).toBeGreaterThan(0);

    const future = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const afterFuture = await executeApi(h, owner, AUDIT, { after: future });
    expect((payload(afterFuture, 'auditLog') as { totalCount: number }).totalCount).toBe(0);
    const beforePast = await executeApi(h, owner, AUDIT, { before: past });
    expect((payload(beforePast, 'auditLog') as { totalCount: number }).totalCount).toBe(0);
    const windowed = await executeApi(h, owner, AUDIT, { after: past, before: future });
    expect((payload(windowed, 'auditLog') as { totalCount: number }).totalCount).toBe(allCount);

    // Malformed dates are a typed validation error, not a crash.
    expect(errorCode(await executeApi(h, owner, AUDIT, { after: 'not-a-date' }))).toBe('VALIDATION');
  });

  it('removes an avatar and clears avatarUrl, guarded for writers only', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVQI12P8//8/AwMDEwMDAwMDAwAkBgMBvR7jugAAAABJRU5ErkJggg==',
      'base64',
    );
    await h.services.users.uploadAvatar(owner, png);
    const withAvatar = await executeApi(h, owner, 'query { viewer { avatarUrl } }');
    expect((payload(withAvatar, 'viewer') as { avatarUrl: string | null }).avatarUrl).toMatch(/\/avatars\//);

    const readKey = apiActor(owner, 'read');
    expect(errorCode(await executeApi(h, readKey, 'mutation { removeAvatar { id } }'))).toBe('FORBIDDEN');

    const removed = await executeApi(h, owner, 'mutation { removeAvatar { id avatarUrl } }');
    expect((payload(removed, 'removeAvatar') as { avatarUrl: string | null }).avatarUrl).toBeNull();
    const after = await executeApi(h, owner, 'query { viewer { avatarUrl } }');
    expect((payload(after, 'viewer') as { avatarUrl: string | null }).avatarUrl).toBeNull();
  });
});

describe('GitHub App manifest setup API', () => {
  const BEGIN = 'mutation Begin($organization: String) { beginGithubAppSetup(organization: $organization) { action manifest } }';
  const CONFIRM = 'mutation Confirm($input: ConfirmGithubAppInput!) { confirmGithubAppSetup(input: $input) }';
  const REMOVE = 'mutation { removeGithubApp }';

  it('lets the owner begin setup with a github.com action URL, state, and webhook hook URL', async () => {
    const begun = payload(await executeApi(h, owner, BEGIN), 'beginGithubAppSetup') as { action: string; manifest: string };
    const url = new URL(begun.action);
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('state')).toBeTruthy();
    const manifest = JSON.parse(begun.manifest) as { hook_attributes: { url: string } };
    expect(manifest.hook_attributes.url.endsWith('/api/github/webhook')).toBe(true);
    const org = payload(await executeApi(h, owner, BEGIN, { organization: 'acme' }), 'beginGithubAppSetup') as { action: string };
    expect(org.action).toContain('https://github.com/organizations/acme/settings/apps/new?state=');
  });

  it('rejects an invalid organization name', async () => {
    for (const organization of ['bad org', '-lead', 'a/b', 'x'.repeat(40)]) {
      expect(errorCode(await executeApi(h, owner, BEGIN, { organization }))).toBe('VALIDATION');
    }
  });

  it('rejects members for begin, confirm, and remove', async () => {
    expect(errorCode(await executeApi(h, member, BEGIN))).toBe('FORBIDDEN');
    expect(errorCode(await executeApi(h, member, CONFIRM, { input: { code: 'c', state: 's' } }))).toBe('FORBIDDEN');
    expect(errorCode(await executeApi(h, member, REMOVE))).toBe('FORBIDDEN');
    expect(errorCode(await executeApi(h, null, BEGIN))).toBe('UNAUTHENTICATED');
  });

  it('rejects a tampered state without calling GitHub', async () => {
    const begun = payload(await executeApi(h, owner, BEGIN), 'beginGithubAppSetup') as { action: string };
    const state = new URL(begun.action).searchParams.get('state') ?? '';
    let calls = 0;
    const original = h.services.github.fetchImpl;
    h.services.github.fetchImpl = (async () => { calls += 1; return new Response('{}'); }) as typeof fetch;
    try {
      for (const bad of ['forged.state.sig', `${state}x`, '']) {
        expect(errorCode(await executeApi(h, owner, CONFIRM, { input: { code: 'code', state: bad } }))).toBe('VALIDATION');
      }
    } finally {
      h.services.github.fetchImpl = original;
    }
    expect(calls).toBe(0);
  });

  it('requires a session, not an API key, to begin or confirm setup', async () => {
    const key = apiActor(owner, 'write');
    expect(errorCode(await executeApi(h, key, BEGIN))).toBe('FORBIDDEN');
    expect(errorCode(await executeApi(h, key, CONFIRM, { input: { code: 'c', state: 's' } }))).toBe('FORBIDDEN');
  });
});

function ownerReadActor(actor: ServiceActor): ServiceActor {
  return apiActor(actor, 'read');
}
