import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, apiActor, call, connect, createHarness, inProcessExecutor, setupOwner } from './helpers';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Harness, ServiceActor } from './helpers';
import { toolDefinitions } from '../src/index';

let h: Harness;
let owner: ServiceActor;
let writer: { client: Client; close(): Promise<void> };
let reader: { client: Client; close(): Promise<void> };
let teamKey: string;

beforeAll(async () => {
  h = await createHarness();
  owner = await setupOwner(h, 'owner');
  await addMember(h, owner, 'bob');
  writer = await connect(inProcessExecutor(h, apiActor(owner, 'write')));
  reader = await connect(inProcessExecutor(h, apiActor(owner, 'read')));
  const teams = await h.services.teams.list(owner);
  const first = teams[0];
  if (first) {
    teamKey = first.key;
  } else {
    const t = await h.services.teams.create(owner, { key: 'ENG', name: 'Engineering' });
    teamKey = t.key;
  }
});

afterAll(async () => {
  await writer?.close();
  await reader?.close();
  await h?.close();
});

const EXPECTED = ['create_issue', 'update_issue', 'get_issue', 'search_issues', 'list_issues', 'add_comment', 'manage_labels', 'set_status', 'assign_issue', 'list_teams', 'list_cycles', 'get_project', 'list_projects'];

describe('server surface', () => {
  it('registers exactly the 13 SPEC tools and the guide prompt', async () => {
    const tools = await writer.client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([...EXPECTED].sort());
    expect(toolDefinitions).toHaveLength(13);
    for (const t of tools.tools) expect(t.inputSchema.type).toBe('object');
    const prompts = await writer.client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain('velocity_guide');
    const p = await writer.client.getPrompt({ name: 'velocity_guide' });
    const c = p.messages[0]?.content;
    expect(c && c.type === 'text' ? c.text : '').toContain('Filter DSL cheat sheet');
  });
});

describe('happy paths', () => {
  let id = '';
  let projectId = '';

  it('list_teams returns keys, workflows and members', async () => {
    const r = await call(writer.client, 'list_teams');
    expect(r.isError).toBe(false);
    const teams = r.data.teams as { key: string; statuses: { name: string; category: string }[]; members: string[] }[];
    const t = teams.find((x) => x.key === teamKey);
    expect(t).toBeDefined();
    expect(t?.statuses.length).toBeGreaterThan(2);
    expect(t?.statuses[0]).toHaveProperty('category');
    expect(r.text).toContain(teamKey);
    expect(r.data.labels).toBeInstanceOf(Array);
  });

  it('create_issue in default status with priority name, assignee me', async () => {
    const r = await call(writer.client, 'create_issue', { team_key: teamKey.toLowerCase(), title: 'Fix the login bug', description: 'Users cannot log in.', priority: 'high', assignee: 'me' });
    expect(r.isError).toBe(false);
    const issue = r.data.issue as { identifier: string; id: string; priority: number; assignee: string; statusCategory: string };
    expect(issue.identifier).toMatch(new RegExp(`^${teamKey}-\\d+$`));
    expect(issue.priority).toBe(1);
    expect(issue.assignee).toBe('owner');
    id = issue.identifier;
    expect(r.text).toContain(id);
  });

  it('create_issue with status, label names and numeric priority', async () => {
    const teams = await call(writer.client, 'list_teams');
    const labels = teams.data.labels as string[];
    expect(labels.length).toBeGreaterThan(0);
    const r = await call(writer.client, 'create_issue', { team_key: teamKey, title: 'Labelled', priority: 2, labels: [labels[0]?.toUpperCase()], status: 'in progress', assignee: 'bob' });
    expect(r.isError).toBe(false);
    const issue = r.data.issue as { status: string; labels: string[]; assignee: string };
    expect(issue.status.toLowerCase()).toBe('in progress');
    expect(issue.labels).toHaveLength(1);
    expect(issue.assignee).toBe('bob');
  });

  it('get_issue by identifier (case-insensitive) and by UUID', async () => {
    const r = await call(writer.client, 'get_issue', { identifier: id.toLowerCase() });
    expect(r.isError).toBe(false);
    const issue = r.data.issue as { id: string; description: string; url: string; comments: unknown[]; linkedPullRequests: unknown[]; subIssues: unknown[] };
    expect(issue.description).toBe('Users cannot log in.');
    expect(issue.url).toContain('/issue/');
    expect(issue.comments).toEqual([]);
    const byUuid = await call(writer.client, 'get_issue', { id: issue.id });
    expect((byUuid.data.issue as { identifier: string }).identifier).toBe(id);
    expect(r.text).toContain('Users cannot log in.');
  });

  it('update_issue applies a full patch', async () => {
    const sub = await call(writer.client, 'create_issue', { team_key: teamKey, title: 'Sub task' });
    const subId = (sub.data.issue as { identifier: string }).identifier;
    const labels = (await call(writer.client, 'list_teams')).data.labels as string[];
    const r = await call(writer.client, 'update_issue', {
      issue_id: id,
      patch: { title: 'Fix the login bug (v2)', description: 'new body', priority: 'urgent', estimate: 3, labels: [labels[0]], assignee: 'bob', status: 'IN PROGRESS' },
    });
    expect(r.isError).toBe(false);
    const issue = r.data.issue as { title: string; priority: number; estimate: number; assignee: string; status: string; labels: string[] };
    expect(issue).toMatchObject({ title: 'Fix the login bug (v2)', priority: 0, estimate: 3, assignee: 'bob' });
    expect(issue.status.toLowerCase()).toBe('in progress');
    expect(issue.labels).toEqual([labels[0]]);
    const un = await call(writer.client, 'update_issue', { identifier: id, patch: { assignee: null, estimate: null, parent: null } });
    expect((un.data.issue as { assignee: string | null; estimate: number | null }).assignee).toBeNull();
    expect((un.data.issue as { estimate: number | null }).estimate).toBeNull();
    const par = await call(writer.client, 'update_issue', { issue_id: subId, patch: { parent: id } });
    expect((par.data.issue as { parent: string }).parent).toBe(id);
    const detail = await call(writer.client, 'get_issue', { identifier: id });
    const subs = (detail.data.issue as { subIssues: { identifier: string }[] }).subIssues;
    expect(subs.map((s) => s.identifier)).toContain(subId);
  });

  it('set_status is workflow aware (case-insensitive)', async () => {
    const r = await call(writer.client, 'set_status', { identifier: id, status_name: 'done' });
    expect(r.isError).toBe(false);
    expect((r.data.issue as { statusCategory: string }).statusCategory).toBe('done');
    expect(r.text).toContain(id);
  });

  it('assign_issue by username, me, and null', async () => {
    const a = await call(writer.client, 'assign_issue', { identifier: id, assignee: '@bob' });
    expect((a.data.issue as { assignee: string }).assignee).toBe('bob');
    const m = await call(writer.client, 'assign_issue', { identifier: id, assignee: 'me' });
    expect((m.data.issue as { assignee: string }).assignee).toBe('owner');
    const n = await call(writer.client, 'assign_issue', { identifier: id, assignee: null });
    expect((n.data.issue as { assignee: unknown }).assignee).toBeNull();
  });

  it('manage_labels add and remove', async () => {
    const labels = (await call(writer.client, 'list_teams')).data.labels as string[];
    const name = labels[1] ?? labels[0];
    const add = await call(writer.client, 'manage_labels', { action: 'add', identifier: id, labels: [name] });
    expect(add.isError).toBe(false);
    expect((add.data.issue as { labels: string[] }).labels).toContain(name);
    const rm = await call(writer.client, 'manage_labels', { action: 'remove', identifier: id, label: name });
    expect((rm.data.issue as { labels: string[] }).labels).not.toContain(name);
  });

  it('add_comment as the key user, visible in get_issue', async () => {
    const r = await call(writer.client, 'add_comment', { identifier: id, body_md: 'Investigated: **root cause** found.' });
    expect(r.isError).toBe(false);
    const g = await call(writer.client, 'get_issue', { identifier: id });
    const comments = (g.data.issue as { comments: { author: string; bodyMd: string }[] }).comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ author: 'owner', bodyMd: 'Investigated: **root cause** found.' });
    expect(g.text).toContain('root cause');
  });

  it('list_issues with DSL, status and assignee merging, and paging', async () => {
    for (let i = 0; i < 3; i++) await call(writer.client, 'create_issue', { team_key: teamKey, title: `Bulk ${i}`, priority: 3, assignee: 'me' });
    const all = await call(writer.client, 'list_issues', { team_key: teamKey });
    expect(all.isError).toBe(false);
    expect((all.data.count as number)).toBeGreaterThanOrEqual(6);
    const dsl = await call(writer.client, 'list_issues', { team_key: teamKey, filter_dsl: 'priority lt:2 order:priority asc' });
    const hits = (dsl.data.issues as { priority: number }[]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((i) => i.priority < 2)).toBe(true);
    const mine = await call(writer.client, 'list_issues', { filter_dsl: 'title contains:Bulk order:createdAt asc', assignee: 'me', status: 'Todo' });
    expect(mine.isError).toBe(false);
    expect(mine.data.filter).toContain('assignee:me');
    expect(mine.data.filter).toMatch(/order:createdAt asc$/);
    const p1 = await call(writer.client, 'list_issues', { team_key: teamKey, limit: 2 });
    expect(p1.data.next_cursor).toBeTruthy();
    const p2 = await call(writer.client, 'list_issues', { team_key: teamKey, limit: 2, cursor: p1.data.next_cursor });
    expect(p2.isError).toBe(false);
    const ids1 = (p1.data.issues as { identifier: string }[]).map((i) => i.identifier);
    const ids2 = (p2.data.issues as { identifier: string }[]).map((i) => i.identifier);
    expect(ids2.some((x) => ids1.includes(x))).toBe(false);
  });

  it('search_issues finds by text and intersects with the DSL', async () => {
    const r = await call(writer.client, 'search_issues', { query: 'login' });
    expect(r.isError).toBe(false);
    expect((r.data.issues as { identifier: string }[]).map((i) => i.identifier)).toContain(id);
    const narrowed = await call(writer.client, 'search_issues', { query: 'login', filter_dsl: 'priority:4' });
    expect(narrowed.isError).toBe(false);
    expect((narrowed.data.issues as { identifier: string }[]).map((i) => i.identifier)).not.toContain(id);
    const kept = await call(writer.client, 'search_issues', { query: 'login', filter_dsl: 'statusCategory:done', limit: 5 });
    expect((kept.data.issues as { identifier: string }[]).map((i) => i.identifier)).toContain(id);
  });

  it('list_cycles on a cycle-enabled team', async () => {
    const t = await h.services.teams.create(owner, { key: 'OPS', name: 'Ops', cycleEnabled: true, cycleLengthWeeks: 1, cycleStartDay: 1, cycleTimezone: 'UTC' });
    await h.services.cycles.rotateTeam(t.id);
    const r = await call(writer.client, 'list_cycles', { team_key: 'ops' });
    expect(r.isError).toBe(false);
    const cycles = r.data.cycles as { state: string; liveStats: { scopeCount: number } }[];
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles.some((c) => c.state === 'active')).toBe(true);
    expect(cycles[0]?.liveStats).toHaveProperty('scopeCount');
  });

  it('projects: list, filter, get (by id and name) with milestones', async () => {
    const team = (await h.services.teams.list(owner)).find((t) => t.key === teamKey);
    const p = await h.services.projects.create(owner, { name: 'Website Revamp', teamIds: team ? [team.id] : [] });
    await h.services.projects.createMilestone(owner, p.id, { name: 'Beta' });
    projectId = p.id;
    const list = await call(writer.client, 'list_projects', { team_key: teamKey });
    expect((list.data.projects as { name: string }[]).map((x) => x.name)).toContain('Website Revamp');
    const none = await call(writer.client, 'list_projects', { status: 'completed' });
    expect(none.data.count).toBe(0);
    const g = await call(writer.client, 'get_project', { id: projectId });
    const proj = g.data.project as { milestones: { name: string }[]; progress: { total: number } };
    expect(proj.milestones.map((m) => m.name)).toEqual(['Beta']);
    expect(proj.progress).toHaveProperty('percent');
    const byName = await call(writer.client, 'get_project', { id: 'website revamp' });
    expect(byName.isError).toBe(false);
    const upd = await call(writer.client, 'update_issue', { issue_id: id, patch: { project_id: projectId } });
    expect(upd.isError).toBe(false);
    expect((upd.data.issue as { project: string }).project).toBe('Website Revamp');
  });

  it('get_issue includes relations', async () => {
    const other = await call(writer.client, 'create_issue', { team_key: teamKey, title: 'Blocked thing' });
    const oid = (other.data.issue as { identifier: string; id: string }).identifier;
    const exec = inProcessExecutor(h, apiActor(owner, 'write'));
    const a = await call(writer.client, 'get_issue', { identifier: id });
    const r = await exec(
      'mutation($i: ID!, $t: ID!) { addRelation(issueId: $i, targetIssueId: $t, type: blocks) { id } }',
      { i: (a.data.issue as { id: string }).id, t: (other.data.issue as { id: string }).id },
    );
    expect(r.errors).toBeUndefined();
    const g = await call(writer.client, 'get_issue', { identifier: id });
    const rel = (g.data.issue as { relations: { type: string; identifier: string }[] }).relations;
    expect(rel).toEqual([expect.objectContaining({ type: 'blocks', identifier: oid })]);
    expect(g.text).toContain(`blocks ${oid}`);
  });

  it('read-scoped key can use every read tool', async () => {
    for (const [name, args] of [
      ['list_teams', {}],
      ['get_issue', { identifier: id }],
      ['list_issues', { team_key: teamKey }],
      ['search_issues', { query: 'login' }],
      ['list_projects', {}],
    ] as const) {
      const r = await call(reader.client, name, args);
      expect(r.isError, name).toBe(false);
    }
  });
});

describe('denied (read-scoped key)', () => {
  it.each([
    ['create_issue', { team_key: 'ENG', title: 'x' }],
    ['update_issue', { issue_id: 'ENG-1', patch: { title: 'x' } }],
    ['set_status', { identifier: 'ENG-1', status_name: 'Done' }],
    ['assign_issue', { identifier: 'ENG-1', assignee: 'me' }],
    ['manage_labels', { action: 'add', identifier: 'ENG-1', labels: ['Bug'] }],
    ['add_comment', { identifier: 'ENG-1', body_md: 'hi' }],
  ])('%s returns isError with FORBIDDEN guidance', async (name, args) => {
    // make sure the referenced issue exists so we exercise the permission check, not NOT_FOUND
    const first = await call(writer.client, 'list_issues', { team_key: teamKey, limit: 1 });
    const ident = (first.data.issues as { identifier: string }[])[0]?.identifier ?? 'ENG-1';
    const a = JSON.parse(JSON.stringify(args).replace('ENG-1', ident).replace('"team_key":"ENG"', `"team_key":"${teamKey}"`)) as Record<string, unknown>;
    if (name === 'manage_labels') {
      const labels = (await call(writer.client, 'list_teams')).data.labels as string[];
      a.labels = [labels[0]];
    }
    const r = await call(reader.client, name, a);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/FORBIDDEN/);
    expect(r.text).toMatch(/write-scoped key/);
    expect((r.data.error as { code: string }).code).toBe('FORBIDDEN');
  });
});

describe('errors', () => {
  it('malformed DSL returns VALIDATION with a caret (list_issues and search_issues)', async () => {
    const l = await call(writer.client, 'list_issues', { team_key: teamKey, filter_dsl: 'priority lt: and' });
    expect(l.isError).toBe(true);
    expect(l.text).toContain('VALIDATION');
    expect(l.text).toContain('^');
    expect((l.data.error as { caret?: string }).caret).toContain('^');
    const s = await call(writer.client, 'search_issues', { query: 'login', filter_dsl: 'bogusfield:x' });
    expect(s.isError).toBe(true);
    expect(s.text).toContain('^');
  });

  it('unknown status names list the valid ones', async () => {
    const first = await call(writer.client, 'list_issues', { team_key: teamKey, limit: 1 });
    const ident = (first.data.issues as { identifier: string }[])[0]?.identifier as string;
    const r = await call(writer.client, 'set_status', { identifier: ident, status_name: 'Nonexistent' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Valid statuses');
    expect(r.text).toContain('Done');
    const c = await call(writer.client, 'create_issue', { team_key: teamKey, title: 'x', status: 'Nope' });
    expect(c.isError).toBe(true);
    expect(c.text).toContain('Valid statuses');
  });

  it('unknown label names list the available labels', async () => {
    const first = await call(writer.client, 'list_issues', { team_key: teamKey, limit: 1 });
    const ident = (first.data.issues as { identifier: string }[])[0]?.identifier as string;
    const r = await call(writer.client, 'manage_labels', { action: 'add', identifier: ident, labels: ['no-such-label'] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Unknown label');
    expect(r.text).toContain('Available labels');
    const c = await call(writer.client, 'create_issue', { team_key: teamKey, title: 'x', labels: ['zzz'] });
    expect(c.isError).toBe(true);
  });

  it('not-found identifiers, teams, users, projects', async () => {
    for (const [name, args] of [
      ['get_issue', { identifier: `${teamKey}-99999` }],
      ['set_status', { identifier: `${teamKey}-99999`, status_name: 'Done' }],
      ['add_comment', { identifier: `${teamKey}-99999`, body_md: 'x' }],
      ['update_issue', { issue_id: `${teamKey}-99999`, patch: { title: 'x' } }],
      ['create_issue', { team_key: 'NOPE', title: 'x' }],
      ['list_cycles', { team_key: 'NOPE' }],
      ['get_project', { id: '00000000-0000-4000-8000-000000000000' }],
      ['get_project', { id: 'No such project' }],
    ] as const) {
      const r = await call(writer.client, name, args);
      expect(r.isError, name).toBe(true);
      expect(r.text, name).toContain('NOT_FOUND');
    }
    const u = await call(writer.client, 'assign_issue', { identifier: `${teamKey}-1`, assignee: 'ghost' });
    expect(u.isError).toBe(true);
    const unknownTeam = await call(writer.client, 'create_issue', { team_key: 'NOPE', title: 'x' });
    expect(unknownTeam.text).toContain('Available teams');
  });

  it('zod validation happens before any GraphQL call', async () => {
    let calls = 0;
    const spy = connect(async () => {
      calls++;
      return { data: {} };
    });
    const { client, close } = await spy;
    for (const [name, args] of [
      ['create_issue', { team_key: teamKey, title: '' }],
      ['create_issue', { team_key: teamKey, title: 'x', priority: 9 }],
      ['get_issue', { identifier: 'not an id' }],
      ['set_status', { identifier: 'ENG-1' }],
      ['update_issue', { issue_id: 'ENG-1', patch: {} }],
      ['update_issue', { patch: { title: 'x' } }],
      ['manage_labels', { action: 'toggle', identifier: 'ENG-1', labels: ['a'] }],
      ['list_issues', { limit: 500 }],
      ['assign_issue', { identifier: 'ENG-1' }],
    ] as const) {
      const r = await call(client, name, args);
      expect(r.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
    }
    expect(calls).toBe(0);
    await close();
  });

  it('executor/network failures surface as tool errors', async () => {
    const { client, close } = await connect(async () => {
      throw new Error('boom');
    });
    const r = await call(client, 'list_teams');
    expect(r.isError).toBe(true);
    expect(r.text).toContain('boom');
    await close();
  });
});
