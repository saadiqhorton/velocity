import { describe, expect, it, vi } from 'vitest';
import { fetchGithubIssues, fetchLinearApi } from '../src';
import { fixtureJson, jsonResponse } from './helpers';

type FetchFn = typeof fetch;

describe('fetchGithubIssues', () => {
  const page1 = fixtureJson<unknown[]>('github-issues-page1.json');
  const page2 = fixtureJson<unknown[]>('github-issues-page2.json');
  const comments = fixtureJson<unknown[]>('github-comments-1.json');
  const milestones = fixtureJson<unknown[]>('github-milestones.json');

  function mock(extra?: (url: string) => Response | undefined) {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      const special = extra?.(url);
      if (special) return special;
      if (url.includes('/milestones')) return jsonResponse(milestones);
      if (url.includes('/issues/1/comments')) return jsonResponse(comments);
      if (url.includes('page=2')) return jsonResponse(page2);
      if (url.includes('/issues?')) {
        return jsonResponse(page1, {
          headers: { link: '<https://api.github.com/repos/acme/widgets/issues?state=all&per_page=100&page=2>; rel="next", <https://x>; rel="last"' },
        });
      }
      return new Response('nope', { status: 404 });
    });
    return { fn: fn as unknown as FetchFn, calls };
  }

  it('paginates, skips PRs and maps fields', async () => {
    const { fn, calls } = mock();
    const progress: number[] = [];
    const b = await fetchGithubIssues({ token: 'ghp_secret', repos: ['acme/widgets'], fetch: fn, onProgress: (d) => progress.push(d) });
    expect(b.source).toBe('github');
    expect(b.issues.map((i) => i.externalId)).toEqual(['acme/widgets#1', 'acme/widgets#2', 'acme/widgets#4', 'acme/widgets#5']);
    expect(progress.at(-1)).toBe(4);
    expect(b.teams).toEqual([{ externalId: 'acme/widgets', key: 'WID', name: 'widgets' }]);
    const status = (n: number) => b.issues.find((i) => i.externalId === `acme/widgets#${n}`)!.statusName;
    expect([status(1), status(2), status(4), status(5)]).toEqual(['Todo', 'Done', 'Canceled', 'Todo']);
    expect(b.statuses.find((s) => s.name === 'Canceled')?.category).toBe('canceled');
    const i1 = b.issues[0]!;
    expect(i1.assigneeExternalId).toBe('bob');
    expect(i1.labelNames).toEqual(['bug']);
    expect(i1.comments).toHaveLength(2);
    expect(i1.comments[0]).toMatchObject({ authorExternalId: 'bob', bodyMd: 'First!' });
    expect(i1.milestoneExternalId).toBe('acme/widgets/milestones/1');
    expect(i1.projectExternalId).toBe('acme/widgets');
    expect(b.projects).toHaveLength(1);
    expect(b.projects[0]).toMatchObject({ name: 'widgets', milestones: [{ name: 'v1.0', targetDate: '2024-04-01T00:00:00.000Z' }] });
    expect(b.users.map((u) => u.username).sort()).toEqual(['alice', 'bob', 'carol']);
    expect(b.issues[2]!.completedAt).toBeNull();
    expect(b.issues[1]!.completedAt).not.toBeNull();
    expect(calls.every((c) => c.headers.Authorization === 'Bearer ghp_secret')).toBe(true);
    expect(calls[0]!.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(calls.some((c) => c.url.includes('/issues?state=all&per_page=100'))).toBe(true);
  });

  it('throws a clear error mentioning the reset time when rate limited', async () => {
    const reset = 1_900_000_000;
    const { fn } = mock((url) =>
      url.includes('/milestones')
        ? jsonResponse({ message: 'rate limit' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } })
        : undefined,
    );
    await expect(fetchGithubIssues({ token: 't', repos: ['acme/widgets'], fetch: fn })).rejects.toThrow(
      new RegExp(`rate limit.*${new Date(reset * 1000).toISOString()}`),
    );
  });

  it('stops before the next request when remaining is 0', async () => {
    const reset = 1_900_000_000;
    const { fn } = mock((url) =>
      url.includes('/milestones') ? jsonResponse(milestones, { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }) : undefined,
    );
    await expect(fetchGithubIssues({ token: 't', repos: ['acme/widgets'], fetch: fn })).rejects.toThrow(/resets at/);
  });

  it('rejects malformed repo names and reports 404/401', async () => {
    await expect(fetchGithubIssues({ token: 't', repos: ['nope'], fetch: mock().fn })).rejects.toThrow(/owner\/repo/);
    const { fn } = mock(() => new Response('', { status: 404 }));
    await expect(fetchGithubIssues({ token: 't', repos: ['a/b'], fetch: fn })).rejects.toThrow(/not found/);
  });

  it('gives each repo a distinct key', async () => {
    const empty = (async () => jsonResponse([])) as unknown as FetchFn;
    const b = await fetchGithubIssues({ token: 't', repos: ['a/widgets', 'b/widgets'], fetch: empty });
    expect(new Set(b.teams.map((t) => t.key)).size).toBe(2);
    expect(b.projects).toEqual([]);
  });
});

describe('fetchLinearApi', () => {
  const fx = fixtureJson<Record<string, unknown>>('linear-api-responses.json');

  function mock(overrides?: (query: string, vars: Record<string, unknown>) => Response | undefined) {
    const requests: { query: string; vars: Record<string, unknown>; headers: Record<string, string>; url: string }[] = [];
    const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      requests.push({ query: body.query, vars: body.variables, headers: (init?.headers ?? {}) as Record<string, string>, url: String(input) });
      const o = overrides?.(body.query, body.variables);
      if (o) return o;
      for (const f of ['teams', 'users', 'issueLabels', 'projects', 'cycles']) {
        if (body.query.includes(`${f}(first`)) return jsonResponse(fx[f]);
      }
      if (body.query.includes('issues(first')) return jsonResponse(body.variables.after ? fx['issues-page2'] : fx['issues-page1']);
      return jsonResponse({ errors: [{ message: 'unexpected' }] });
    });
    return { fn: fn as unknown as FetchFn, requests };
  }

  it('fetches, paginates and remaps', async () => {
    const { fn, requests } = mock();
    const progress: number[] = [];
    const b = await fetchLinearApi({ apiKey: 'lin_api_secret', fetch: fn, onProgress: (d) => progress.push(d) });
    expect(requests[0]!.url).toBe('https://api.linear.app/graphql');
    expect(requests.every((r) => r.headers.Authorization === 'lin_api_secret')).toBe(true);
    const issueReqs = requests.filter((r) => r.query.includes('issues(first'));
    expect(issueReqs).toHaveLength(2);
    expect(issueReqs[1]!.vars.after).toBe('cursor-1');
    expect(progress).toEqual([2, 5]);
    expect(b.source).toBe('linear');
    expect(b.issues).toHaveLength(5);
    expect(b.teams.map((t) => t.key)).toEqual(['ENG', 'DES']);
    const get = (id: string) => b.issues.find((i) => i.externalId === id)!;
    // API 1..4 -> Velocity 0..3, API 0 -> 4
    expect([get('ENG-1'), get('ENG-2'), get('ENG-3'), get('DES-1'), get('DES-2')].map((i) => i.priority)).toEqual([0, 4, 1, 2, 3]);
    const cat = (n: string, t = 't-eng') => b.statuses.find((s) => s.name === n && s.teamExternalId === t)?.category;
    expect([cat('Backlog'), cat('Todo'), cat('In Progress'), cat('Done'), cat('Canceled'), cat('Triage')]).toEqual([
      'backlog', 'todo', 'in_progress', 'done', 'canceled', 'backlog',
    ]);
    expect(get('ENG-3').estimate).toBe(40);
    expect(get('ENG-2').parentExternalId).toBe('ENG-1');
    expect(get('ENG-1').relations).toEqual(expect.arrayContaining([{ type: 'blocks', targetExternalId: 'ENG-2' }, { type: 'related', targetExternalId: 'DES-1' }]));
    expect(get('ENG-2').relations).toEqual([{ type: 'duplicate', targetExternalId: 'ENG-3' }]);
    expect(get('DES-1').relations).toEqual([]); // related pair stored once
    expect(get('ENG-1').comments[0]).toMatchObject({ authorExternalId: 'u2', authorName: 'Bob Martin', bodyMd: 'Looking' });
    expect(get('ENG-1').attachments).toEqual([{ name: 'Spec', url: 'https://example.com/spec' }]);
    expect(get('ENG-1').cycleExternalId).toBe('c1');
    expect(get('DES-1').archivedAt).toBe('2024-03-09T00:00:00.000Z');
    expect(get('ENG-3').completedAt).toBe('2024-03-05T10:00:00.000Z');
    expect(b.labels).toContainEqual({ name: 'Frontend', group: 'Area' });
    expect(b.users[0]).toMatchObject({ externalId: 'u1', email: 'alice@example.com', username: 'alice' });
    expect(b.projects[0]).toMatchObject({ status: 'in_progress', leadExternalId: 'u1', milestones: [{ externalId: 'm1' }] });
    expect(b.cycles[0]).toMatchObject({ number: 1, teamExternalId: 't-eng' });
    expect(JSON.stringify(b)).not.toContain('lin_api_secret');
  });

  it('filters by team keys', async () => {
    const { fn, requests } = mock((q, v) => {
      if (q.includes('issues(first')) {
        expect(v.filter).toEqual({ team: { key: { in: ['DES'] } } });
        const nodes = (fx['issues-page2'] as { data: { issues: { nodes: { team: { id: string } }[] } } }).data.issues.nodes.filter((n) => n.team.id === 't-des');
        return jsonResponse({ data: { issues: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } });
      }
      return undefined;
    });
    const b = await fetchLinearApi({ apiKey: 'k', fetch: fn, teamKeys: ['des'] });
    expect(b.teams.map((t) => t.key)).toEqual(['DES']);
    expect(b.issues.map((i) => i.externalId)).toEqual(['DES-1', 'DES-2']);
    expect(requests.some((r) => r.query.includes('issues(first'))).toBe(true);
  });

  it('surfaces GraphQL and rate-limit errors', async () => {
    const bad = mock(() => jsonResponse({ errors: [{ message: 'Authentication required' }] }, { status: 400 }));
    await expect(fetchLinearApi({ apiKey: 'k', fetch: bad.fn })).rejects.toThrow(/Authentication required/);
    const rl = mock(() => jsonResponse({ errors: [{ message: 'slow down', extensions: { code: 'RATELIMITED' } }] }, { status: 400 }));
    await expect(fetchLinearApi({ apiKey: 'k', fetch: rl.fn })).rejects.toThrow(/rate limit/i);
  });
});
