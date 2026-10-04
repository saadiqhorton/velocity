import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFilter } from '../../../graphql/src/dsl/index';
import type { Harness } from '../helpers/harness';
import { addMember, apiActor, createHarness, setupOwner } from '../helpers/harness';
import type { ServiceActor } from '../../src/index';
import { systemActor } from '../../src/context';

let h: Harness;
let owner: ServiceActor;
let member: ServiceActor;

beforeAll(async () => {
  h = await createHarness();
  owner = await setupOwner(h);
  member = await addMember(h, owner, 'mia');
});
afterAll(async () => h.close());

describe('auth', () => {
  it('rejects a second setup and allows login', async () => {
    await expect(h.services.auth.setupWorkspace({ workspaceName: 'X', username: 'x2', password: 'another-long-password-1' }, {})).rejects.toMatchObject({ code: 'CONFLICT' });
    const s = await h.services.auth.login({ login: 'owner', password: 'correct-horse-battery-staple' }, { ip: '1.1.1.1' });
    expect(s.user.isOwner).toBe(true);
    const resolved = await h.services.auth.resolveSession(s.token);
    expect(resolved?.user.id).toBe(owner.userId);
    await expect(h.services.auth.login({ login: 'owner', password: 'wrong-password-123' }, { ip: '1.1.1.1' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('enforces password policy', async () => {
    const inv = await h.services.auth.createInvite(owner, {});
    await expect(h.services.auth.acceptInvite({ token: inv.token, username: 'weak', password: 'short' }, {})).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(h.services.auth.acceptInvite({ token: inv.token, username: 'weak', password: 'password123' }, {})).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('members cannot invite (owner-only)', async () => {
    await expect(h.services.auth.createInvite(member, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('api keys: create, resolve, revoke', async () => {
    const { plaintext, apiKey } = await h.services.apiKeys.create(member, { name: 'ci', scope: 'read' });
    expect(plaintext.startsWith('vel_')).toBe(true);
    const r = await h.services.auth.resolveApiKey(plaintext);
    expect(r?.apiKey.id).toBe(apiKey.id);
    expect(await h.services.auth.resolveApiKey(plaintext.slice(0, -1) + 'x')).toBeNull();
    await h.services.apiKeys.revoke(member, apiKey.id);
    expect(await h.services.auth.resolveApiKey(plaintext)).toBeNull();
  });
});

describe('issues', () => {
  let teamId: string;
  beforeAll(async () => {
    const team = await h.services.teams.create(owner, { key: 'ENG', name: 'Engineering' });
    teamId = team.id;
  });

  it('creates issues with gapless numbers under parallel load', async () => {
    const created = await Promise.all(Array.from({ length: 40 }, (_, i) => h.services.issues.create(member, { teamId, title: `Parallel ${i}` })));
    const numbers = created.map((c) => c.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it('defaults to the first backlog status and stamps lifecycle', async () => {
    const statuses = await h.services.teams.statuses(teamId);
    const i = await h.services.issues.create(owner, { teamId, title: 'Lifecycle', priority: 1 });
    expect(i.statusId).toBe(statuses.find((s) => s.category === 'backlog')!.id);
    const done = statuses.find((s) => s.category === 'done')!;
    const u = await h.services.issues.update(owner, i.id, { statusId: done.id });
    expect(u.completedAt).toBeInstanceOf(Date);
    const back = await h.services.issues.update(owner, i.id, { statusId: statuses.find((s) => s.category === 'todo')!.id });
    expect(back.completedAt).toBeNull();
    const activity = await h.services.issues.activity(i.id);
    expect(activity.map((a) => a.type)).toEqual(['created', 'status', 'status']);
  });

  it('resolves identifiers and filters with the DSL', async () => {
    const a = await h.services.issues.create(owner, { teamId, title: 'Fix login redirect', priority: 0, assigneeId: member.userId });
    const bug = await h.services.labels.byName('Bug');
    await h.services.issues.update(owner, a.id, { labelIds: [bug!.id] });
    const ident = `ENG-${a.number}`;
    expect((await h.services.issues.getByIdentifier(ident.toLowerCase()))?.id).toBe(a.id);
    const asMember = await h.services.issues.list(member, { filter: parseFilter('assignee:me and priority lt:2 and label:bug') });
    expect(asMember.nodes.map((n) => n.id)).toEqual([a.id]);
    const notBug = await h.services.issues.list(member, { filter: parseFilter('not label:bug and title contains:"Parallel 1"') });
    expect(notBug.nodes.length).toBeGreaterThan(0);
    expect(notBug.nodes.every((n) => n.id !== a.id)).toBe(true);
    const groupLabel = await h.services.issues.list(member, { filter: parseFilter('label:Type') });
    expect(groupLabel.nodes.map((n) => n.id)).toContain(a.id);
    const unassigned = await h.services.issues.list(member, { filter: parseFilter('assignee neq:mia') });
    expect(unassigned.nodes.every((n) => n.assigneeId !== member.userId)).toBe(true);
    expect(await unassigned.totalCount()).toBeGreaterThan(40);
    const byIdent = await h.services.issues.list(member, { filter: parseFilter(`identifier:${ident}`) });
    expect(byIdent.nodes).toHaveLength(1);
    const ordered = await h.services.issues.list(member, { filter: parseFilter('order:createdAt asc'), first: 3 });
    expect(ordered.nodes[0]!.title).toMatch(/Parallel/);
    expect(ordered.hasNextPage).toBe(true);
  });

  it('read-scoped API keys cannot write', async () => {
    await expect(h.services.issues.create(apiActor(member, 'read'), { teamId, title: 'nope' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const list = await h.services.issues.list(apiActor(member, 'read'), { first: 1 });
    expect(list.nodes).toHaveLength(1);
  });

  it('enforces sub-issue depth ≤ 5 and prevents cycles', async () => {
    let parent = await h.services.issues.create(owner, { teamId, title: 'L1' });
    const root = parent;
    for (let lvl = 2; lvl <= 5; lvl++) parent = await h.services.issues.create(owner, { teamId, title: `L${lvl}`, parentId: parent.id });
    await expect(h.services.issues.create(owner, { teamId, title: 'L6', parentId: parent.id })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(h.services.issues.update(owner, root.id, { parentId: parent.id })).rejects.toMatchObject({ code: 'VALIDATION' });
    const roll = await h.services.issues.rollups([root.id]);
    expect(roll.get(root.id)).toEqual({ done: 0, total: 1 });
  });

  it('relations: blocked_by stored as inverse, duplicates rejected, is:blocked filter', async () => {
    const a = await h.services.issues.create(owner, { teamId, title: 'Blocker' });
    const b = await h.services.issues.create(owner, { teamId, title: 'Blocked one' });
    const rel = await h.services.issues.addRelation(owner, b.id, 'blocked_by', a.id);
    expect(rel.sourceIssueId).toBe(a.id);
    await expect(h.services.issues.addRelation(owner, a.id, 'blocks', b.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(h.services.issues.addRelation(owner, b.id, 'blocks', a.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    const blocked = await h.services.issues.list(owner, { filter: parseFilter('is:blocked') });
    expect(blocked.nodes.map((n) => n.id)).toEqual([b.id]);
  });

  it('moves between teams with a new number and a moved-pointer', async () => {
    const web = await h.services.teams.create(owner, { key: 'WEB', name: 'Web' });
    const i = await h.services.issues.create(owner, { teamId, title: 'Move me' });
    await h.services.comments.create(owner, { issueId: i.id, bodyMd: 'a comment' });
    const moved = await h.services.issues.move(owner, i.id, web.id);
    expect(moved.number).toBe(1);
    expect(moved.teamId).toBe(web.id);
    const old = await h.services.issues.getByIdentifier(`ENG-${i.number}`, { followMoves: false });
    expect(old?.movedToIssueId).toBe(moved.id);
    expect((await h.services.issues.getByIdentifier(`ENG-${i.number}`))?.id).toBe(moved.id);
    expect(await h.services.comments.listForIssue(moved.id)).toHaveLength(1);
  });

  it('search: identifier fast path and full text over comments', async () => {
    const i = await h.services.issues.create(owner, { teamId, title: 'Payment webhook retries', descriptionMd: 'Stripe sends duplicates' });
    await h.services.comments.create(member, { issueId: i.id, bodyMd: 'Seen with idempotency keys too' });
    const byText = await h.services.search.search(owner, 'idempotency', { types: ['issue'] });
    expect(byText.map((x) => x.id)).toContain(i.id);
    const byIdent = await h.services.search.search(owner, `ENG-${i.number}`, { types: ['issue'] });
    expect(byIdent[0]?.id).toBe(i.id);
    const fuzzy = await h.services.search.search(owner, 'paymnt webhok', { types: ['issue'] });
    expect(fuzzy.map((x) => x.id)).toContain(i.id);
  });

  it('notifications fan out from the outbox exactly once', async () => {
    const i = await h.services.issues.create(owner, { teamId, title: 'Notify', assigneeId: member.userId });
    await h.services.comments.create(owner, { issueId: i.id, bodyMd: 'hey @mia look' });
    await h.services.events.drain();
    await h.services.events.drain();
    const inbox = await h.services.notifications.list(member);
    const forIssue = inbox.filter((n) => n.issueId === i.id).map((n) => n.type).sort();
    expect(forIssue).toEqual(['assigned', 'mentioned']);
    expect(await h.services.notifications.unreadCount(member)).toBeGreaterThan(0);
  });

  it('projects: progress recomputes on issue changes', async () => {
    const p = await h.services.projects.create(owner, { name: 'Launch' });
    const statuses = await h.services.teams.statuses(teamId);
    const i1 = await h.services.issues.create(owner, { teamId, title: 'P1', projectId: p.id, estimate: 3 });
    await h.services.issues.create(owner, { teamId, title: 'P2', projectId: p.id, estimate: 5 });
    await h.services.issues.update(owner, i1.id, { statusId: statuses.find((s) => s.category === 'done')!.id });
    const after = await h.services.projects.require(p.id);
    expect([after.progressDone, after.progressTotal, after.progressPointsDone, after.progressPointsTotal]).toEqual([1, 2, 3, 8]);
  });
});

describe('cycles', () => {
  it('rotates idempotently and carries incomplete issues over', async () => {
    h.clock.now = new Date('2026-03-02T12:00:00Z'); // a Monday
    const team = await h.services.teams.create(owner, { key: 'OPS', name: 'Ops', cycleEnabled: true, cycleLengthWeeks: 1, cycleStartDay: 1, cycleTimezone: 'UTC' });
    await h.services.cycles.rotateTeam(team.id);
    await h.services.cycles.rotateTeam(team.id);
    let all = await h.services.cycles.list(team.id);
    expect(all.map((c) => c.number).sort()).toEqual([1, 2]);
    const current = await h.services.cycles.current(team.id);
    expect(current?.number).toBe(1);
    const statuses = await h.services.teams.statuses(team.id);
    const open = await h.services.issues.create(owner, { teamId: team.id, title: 'Unfinished', cycleId: current!.id, estimate: 2 });
    const done = await h.services.issues.create(owner, { teamId: team.id, title: 'Finished', cycleId: current!.id, estimate: 3, statusId: statuses.find((s) => s.category === 'done')!.id });
    h.clock.now = new Date('2026-03-09T01:00:00Z');
    const res = await Promise.all([h.services.cycles.rotateTeam(team.id), h.services.cycles.rotateTeam(team.id)]);
    expect(res.reduce((s, r) => s + r.closed, 0)).toBe(1);
    all = await h.services.cycles.list(team.id);
    const c1 = all.find((c) => c.number === 1)!;
    expect(c1.closedAt).not.toBeNull();
    expect(c1.stats).toMatchObject({ completedCount: 1, completedPoints: 3, carriedOverCount: 1, scopeCount: 2 });
    const c2 = all.find((c) => c.number === 2)!;
    expect((await h.services.issues.get(open.id))!.cycleId).toBe(c2.id);
    expect((await h.services.issues.get(done.id))!.cycleId).toBe(c1.id);
    await expect(h.services.issues.create(owner, { teamId: team.id, title: 'Cannot join closed cycle', cycleId: c1.id })).rejects.toMatchObject({ code: 'VALIDATION' });
    const historical = await h.services.issues.create(systemActor('import'), { teamId: team.id, title: 'Imported historical issue', cycleId: c1.id });
    expect(historical.cycleId).toBe(c1.id);
    expect(all.map((c) => c.number).sort()).toEqual([1, 2, 3]);
    h.clock.now = null;
  });
});
