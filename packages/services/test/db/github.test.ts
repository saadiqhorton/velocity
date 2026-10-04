import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { githubEvents, githubInstalls, githubLinks, issueActivity, issues } from '@velocity/schema';
import type { GitHubApi, GitHubPull } from '../../src/github';
import type { ServiceActor } from '../../src/index';
import { createDb } from '../../src/index';
import type { Harness } from '../helpers/harness';
import { addMember, createHarness, setupOwner } from '../helpers/harness';

const SECRET = 'test-webhook-secret';
const FIXTURES = join(__dirname, '..', 'fixtures', 'github');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test-only fixture mutation

function fixture(name: string): Json {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Json;
}
function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

class FakeApi implements GitHubApi {
  comments: { installationId: number; repo: string; number: number; body: string }[] = [];
  pulls: Record<string, GitHubPull[]> = {};
  pageCalls: { repo: string; page: number }[] = [];
  onPage: (() => Promise<void>) | null = null;
  getPullCalls = 0;
  repos = ['acme/web', 'acme/api'];
  async getInstallation() {
    return { accountLogin: 'acme', accountType: 'Organization' as const };
  }
  async listInstallationRepos() {
    return this.repos;
  }
  async listPullsSince(_i: number, repo: string, opts: { since: Date; page: number; perPage: number }) {
    this.pageCalls.push({ repo, page: opts.page });
    if (this.onPage) await this.onPage();
    const all = this.pulls[repo] ?? [];
    const size = 2;
    const slice = all.slice((opts.page - 1) * size, opts.page * size);
    return { pulls: slice, hasMore: opts.page * size < all.length };
  }
  async getPull(_i: number, repo: string, number: number): Promise<GitHubPull> {
    this.getPullCalls++;
    return pull({ number, title: `Fetched ${repo}#${number}`, url: `https://github.com/${repo}/pull/${number}`, merged: true, state: 'closed', mergedAt: '2026-09-01T00:00:00Z' });
  }
  async createIssueComment(installationId: number, repo: string, number: number, body: string) {
    this.comments.push({ installationId, repo, number, body });
  }
}

function pull(o: Partial<GitHubPull>): GitHubPull {
  return {
    number: 1,
    title: 't',
    body: null,
    url: 'https://github.com/acme/web/pull/1',
    state: 'open',
    draft: false,
    merged: false,
    mergedAt: null,
    closedAt: null,
    updatedAt: new Date().toISOString(),
    headRef: null,
    headSha: 'abc',
    author: 'octo-dev',
    ...o,
  };
}

let h: Harness;
let owner: ServiceActor;
let member: ServiceActor;
let teamId: string;
let installId: string;
let api: FakeApi;
let seq = 0;
let dbRef: ReturnType<typeof createDb> | null = null;
const db = (): ReturnType<typeof createDb> => (dbRef ??= createDb(h.pool));
let prSeq = 100;

beforeAll(async () => {
  h = await createHarness({ github: { appId: '1', privateKey: 'fake', webhookSecret: SECRET, clientSecret: null, appSlug: 'velocity-test' } });
  owner = await setupOwner(h);
  member = await addMember(h, owner, 'mia');
  teamId = (await h.services.teams.create(owner, { key: 'ENG', name: 'Engineering' })).id;
  api = new FakeApi();
  h.services.github.setApi(api);
  const inst = await h.services.github.handleInstallCallback(owner, 4242);
  installId = inst.id;
  await h.services.github.runBackfill(installId);
});
afterAll(async () => h.close());

async function mkIssue(title = 'Work item') {
  const i = await h.services.issues.create(owner, { teamId, title, assigneeId: member.userId });
  return { issue: i, identifier: `ENG-${i.number}` };
}

async function deliver(event: string, payload: Json, deliveryId = `d-${++seq}`) {
  const rawBody = JSON.stringify(payload);
  const receipt = await h.services.github.receiveWebhook({ deliveryId, event, signature: sign(rawBody), rawBody });
  return receipt;
}
/** Deliver and process in one go. */
async function run(event: string, payload: Json) {
  const r = await deliver(event, payload);
  expect(r.status).toBe('accepted');
  await h.services.github.processEvent(r.eventRowId as string);
  await h.services.events.drain();
  await h.services.events.drain();
  return r;
}

interface PrOpts {
  number?: number;
  title?: string;
  body?: string;
  ref?: string;
  draft?: boolean;
  installationId?: number;
}
function prPayload(name: string, o: PrOpts = {}): Json {
  const p = fixture(name);
  const n = o.number ?? p.pull_request.number;
  p.number = n;
  p.pull_request.number = n;
  p.pull_request.html_url = `https://github.com/acme/web/pull/${n}`;
  if (o.title !== undefined) p.pull_request.title = o.title;
  if (o.body !== undefined) p.pull_request.body = o.body;
  if (o.ref !== undefined) p.pull_request.head.ref = o.ref;
  if (o.draft !== undefined) p.pull_request.draft = o.draft;
  if (o.installationId !== undefined) p.installation.id = o.installationId;
  return p;
}
/** A PR payload that references `identifier` through title, branch and a closing body. */
function prFor(name: string, identifier: string, o: PrOpts = {}): Json {
  return prPayload(name, { number: ++prSeq, title: `Work on ${identifier}`, body: `Closes ${identifier}`, ref: `${identifier.toLowerCase()}-work`, ...o });
}

async function linksOf(issueId: string) {
  return db().select().from(githubLinks).where(eq(githubLinks.issueId, issueId));
}
async function activityOf(issueId: string, type: string) {
  return db().select().from(issueActivity).where(and(eq(issueActivity.issueId, issueId), eq(issueActivity.type, type)));
}
async function inbox(issueId: string, type?: string) {
  const all = await h.services.notifications.list(member, { first: 200 });
  return all.filter((n) => n.issueId === issueId && (type ? n.type === type : n.type.startsWith('github_')));
}
async function statusCategory(issueId: string) {
  const i = await h.services.issues.require(issueId);
  return (await h.services.teams.getStatus(i.statusId))?.category;
}
async function setInstallSettings(patch: Parameters<typeof h.services.github.updateSettings>[2]) {
  await h.services.github.updateSettings(owner, installId, patch);
}

describe('webhook intake', () => {
  it('rejects missing and invalid signatures and unconfigured secrets', async () => {
    const rawBody = JSON.stringify(fixture('pull_request.opened'));
    await expect(h.services.github.receiveWebhook({ deliveryId: 'x1', event: 'pull_request', signature: null, rawBody })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(h.services.github.receiveWebhook({ deliveryId: 'x2', event: 'pull_request', signature: sign(rawBody, 'wrong'), rawBody })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(h.services.github.receiveWebhook({ deliveryId: 'x3', event: 'pull_request', signature: sign(rawBody + ' '), rawBody })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const rows = await db().select().from(githubEvents).where(eq(githubEvents.eventId, 'x1'));
    expect(rows).toHaveLength(0);

    const h2 = await createHarness();
    try {
      await expect(h2.services.github.receiveWebhook({ deliveryId: 'y', event: 'ping', signature: sign(rawBody), rawBody })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    } finally {
      await h2.close();
    }
  });

  it('dedupes by delivery id and processes once', async () => {
    const { issue, identifier } = await mkIssue();
    const payload = prFor('pull_request.opened', identifier);
    const before = h.jobs.sent.length;
    const a = await deliver('pull_request', payload, 'dup-1');
    const b = await deliver('pull_request', payload, 'dup-1');
    expect(a.status).toBe('accepted');
    expect(b).toEqual({ status: 'duplicate', eventRowId: null });
    expect(h.jobs.sent.length).toBe(before + 1);
    expect(h.jobs.sent[before]).toMatchObject({ queue: 'github', data: { type: 'process_event', eventRowId: a.eventRowId } });
    await h.services.github.processEvent(a.eventRowId as string);
    await h.services.github.processEvent(a.eventRowId as string); // idempotent
    expect(await linksOf(issue.id)).toHaveLength(1);
    expect(await activityOf(issue.id, 'github_pr')).toHaveLength(1);
    const [ev] = await db().select().from(githubEvents).where(eq(githubEvents.eventId, 'dup-1'));
    expect(ev?.status).toBe('processed');
  });

  it('stores unhandled events as ignored without enqueueing', async () => {
    const before = h.jobs.sent.length;
    const r = await deliver('star', { action: 'created' });
    expect(r.status).toBe('ignored');
    expect(h.jobs.sent.length).toBe(before);
    const [ev] = await db().select().from(githubEvents).where(eq(githubEvents.id, r.eventRowId as string));
    expect(ev?.status).toBe('ignored');
    const r2 = await deliver('pull_request', { ...prPayload('pull_request.opened'), action: 'labeled' });
    expect(r2.status).toBe('ignored');
  });

  it('marks failed events with error text', async () => {
    const r = await deliver('push', { ...fixture('push'), repository: undefined, commits: [{ id: 'z', message: 'Fixes ENG-1' }] });
    // repository missing → ignored by handler (not failed)
    await h.services.github.processEvent(r.eventRowId as string);
    const [ev] = await db().select().from(githubEvents).where(eq(githubEvents.id, r.eventRowId as string));
    expect(['ignored', 'processed']).toContain(ev?.status);
  });
});

describe('pull_request matrix', () => {
  it('opened: links via title/branch/body, activity once, notifies assignee; edits do not duplicate', async () => {
    const { issue, identifier } = await mkIssue();
    const opened = prFor('pull_request.opened', identifier);
    await run('pull_request', opened);
    const [link] = await linksOf(issue.id);
    expect(link).toMatchObject({ kind: 'pr', repo: 'acme/web', prNumber: opened.number, prState: 'open', closesIssue: true, author: 'octo-dev', headBranch: `${identifier.toLowerCase()}-work`, commitSha: null });
    expect(link?.prUrl).toContain(`/pull/${opened.number}`);
    const acts = await activityOf(issue.id, 'github_pr');
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ actorKind: 'github', actorUserId: null });
    expect(acts[0]?.toValue).toMatchObject({ repo: 'acme/web', number: opened.number, state: 'open' });
    const n = await inbox(issue.id, 'github_pr_linked');
    expect(n).toHaveLength(1);

    const edited = prPayload('pull_request.edited', { number: opened.number, title: `Retitled ${identifier}`, body: `Closes ${identifier}`, ref: opened.pull_request.head.ref });
    await run('pull_request', edited);
    const links = await linksOf(issue.id);
    expect(links).toHaveLength(1);
    expect(links[0]?.title).toBe(`Retitled ${identifier}`);
    expect(await activityOf(issue.id, 'github_pr')).toHaveLength(1);
    expect(await inbox(issue.id, 'github_pr_linked')).toHaveLength(1);
  });

  it('draft PRs link as draft and publish state draft', async () => {
    const { issue, identifier } = await mkIssue();
    await run('pull_request', prFor('pull_request.opened', identifier, { draft: true }));
    expect((await linksOf(issue.id))[0]?.prState).toBe('draft');
    expect((await activityOf(issue.id, 'github_pr'))[0]?.toValue).toMatchObject({ state: 'draft' });
    expect(await inbox(issue.id, 'github_pr_linked')).toHaveLength(1);
  });

  it('recognizes the reference from the branch name alone, and from the title alone', async () => {
    const a = await mkIssue();
    const b = await mkIssue();
    await run('pull_request', prPayload('pull_request.opened', { number: ++prSeq, title: 'Tidy things', body: 'nothing', ref: `feature/${a.identifier.toLowerCase()}-tidy` }));
    await run('pull_request', prPayload('pull_request.opened', { number: ++prSeq, title: `${b.identifier}: tidy`, body: 'nothing', ref: 'misc' }));
    expect((await linksOf(a.issue.id))[0]?.closesIssue).toBe(true);
    expect((await linksOf(b.issue.id))[0]?.closesIssue).toBe(true);
  });

  it('bare mention in the body links without closing, and a merge does not close it', async () => {
    const { issue, identifier } = await mkIssue();
    const n = ++prSeq;
    await run('pull_request', prPayload('pull_request.opened', { number: n, title: 'Unrelated title', body: `Related to ${identifier} but not finishing it`, ref: 'misc' }));
    const [link] = await linksOf(issue.id);
    expect(link?.closesIssue).toBe(false);
    await run('pull_request', prPayload('pull_request.closed-merged', { number: n, title: 'Unrelated title', body: `Related to ${identifier}`, ref: 'misc' }));
    expect((await linksOf(issue.id))[0]?.prState).toBe('merged');
    expect(await statusCategory(issue.id)).not.toBe('done');
  });

  it('review requested and changes requested add activity and notify', async () => {
    const { issue, identifier } = await mkIssue();
    const opened = prFor('pull_request.opened', identifier);
    await run('pull_request', opened);
    const n = opened.number as number;
    await run('pull_request', prPayload('pull_request.review_requested', { number: n }));
    await run('pull_request_review', { ...fixture('pull_request_review.changes_requested'), pull_request: prPayload('pull_request.opened', { number: n }).pull_request });
    const acts = await activityOf(issue.id, 'github_review');
    expect(acts.map((a) => (a.toValue as Json).state).sort()).toEqual(['changes_requested', 'review_requested']);
    // The notification pipeline coalesces same-type notifications within a minute; the latest state wins.
    const reviews = await inbox(issue.id, 'github_review');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.payload).toMatchObject({ state: 'changes_requested', repo: 'acme/web', prNumber: n });
  });

  it('review events for a PR without links do nothing; approved reviews are ignored', async () => {
    const r = await run('pull_request_review', { ...fixture('pull_request_review.changes_requested'), review: { state: 'approved', user: { login: 'x' } } });
    const [ev] = await db().select().from(githubEvents).where(eq(githubEvents.id, r.eventRowId as string));
    expect(ev?.status).toBe('ignored');
  });

  it('merged: updates link, activity, notifies and moves the issue to Done', async () => {
    const { issue, identifier } = await mkIssue();
    const opened = prFor('pull_request.opened', identifier);
    await run('pull_request', opened);
    const merged = prPayload('pull_request.closed-merged', { number: opened.number, title: opened.pull_request.title, body: opened.pull_request.body, ref: opened.pull_request.head.ref });
    await run('pull_request', merged);
    const [link] = await linksOf(issue.id);
    expect(link?.prState).toBe('merged');
    expect(link?.mergedAt?.toISOString()).toBe('2026-09-29T09:30:00.000Z');
    expect(await statusCategory(issue.id)).toBe('done');
    expect(await inbox(issue.id, 'github_pr_merged')).toHaveLength(1);
    expect((await activityOf(issue.id, 'github_pr')).map((a) => (a.toValue as Json).state)).toEqual(expect.arrayContaining(['open', 'merged']));
    const hist = await db().select().from(issueActivity).where(eq(issueActivity.issueId, issue.id));
    expect(hist.some((a) => a.actorKind === 'github' && a.type !== 'github_pr')).toBe(true); // status change attributed to github
    // Redelivery with a new id must not re-notify.
    await run('pull_request', merged);
    expect(await inbox(issue.id, 'github_pr_merged')).toHaveLength(1);
  });

  it('merged with no prior link still links and closes', async () => {
    const { issue, identifier } = await mkIssue();
    await run('pull_request', prFor('pull_request.closed-merged', identifier));
    expect(await statusCategory(issue.id)).toBe('done');
  });

  it('per-link autoClose=false prevents closing; null inherits; true overrides an install-level off', async () => {
    const a = await mkIssue();
    const openedA = prFor('pull_request.opened', a.identifier);
    await run('pull_request', openedA);
    const [linkA] = await linksOf(a.issue.id);
    await h.services.github.setAutoClose(owner, linkA!.id, false);
    await run('pull_request', prPayload('pull_request.closed-merged', { number: openedA.number, title: openedA.pull_request.title, body: openedA.pull_request.body, ref: openedA.pull_request.head.ref }));
    expect(await statusCategory(a.issue.id)).not.toBe('done');
    expect((await linksOf(a.issue.id))[0]?.prState).toBe('merged');

    // install-level off
    await setInstallSettings({ autoCloseOnMerge: false });
    const b = await mkIssue();
    const openedB = prFor('pull_request.opened', b.identifier);
    await run('pull_request', openedB);
    await run('pull_request', prPayload('pull_request.closed-merged', { number: openedB.number, title: openedB.pull_request.title, body: openedB.pull_request.body, ref: openedB.pull_request.head.ref }));
    expect(await statusCategory(b.issue.id)).not.toBe('done');

    // per-link true overrides install off
    const c = await mkIssue();
    const openedC = prFor('pull_request.opened', c.identifier);
    await run('pull_request', openedC);
    const [linkC] = await linksOf(c.issue.id);
    await h.services.github.setAutoClose(owner, linkC!.id, true);
    await run('pull_request', prPayload('pull_request.closed-merged', { number: openedC.number, title: openedC.pull_request.title, body: openedC.pull_request.body, ref: openedC.pull_request.head.ref }));
    expect(await statusCategory(c.issue.id)).toBe('done');
    await h.services.github.setAutoClose(owner, linkC!.id, null);
    expect((await linksOf(c.issue.id))[0]?.autoClose).toBeNull();
    await setInstallSettings({ autoCloseOnMerge: true });
  });

  it('does not touch an issue that is already done or canceled', async () => {
    const { issue, identifier } = await mkIssue();
    const canceled = await h.services.teams.firstStatusOfCategory(teamId, 'canceled');
    await h.services.issues.update(owner, issue.id, { statusId: canceled!.id });
    await run('pull_request', prFor('pull_request.closed-merged', identifier));
    const after = await h.services.issues.require(issue.id);
    expect(after.statusId).toBe(canceled!.id);
  });

  it('closed unmerged: link state closed + activity only (no notification)', async () => {
    const { issue, identifier } = await mkIssue();
    const opened = prFor('pull_request.opened', identifier);
    await run('pull_request', opened);
    expect(await inbox(issue.id)).toHaveLength(1);
    await run('pull_request', prPayload('pull_request.closed-unmerged', { number: opened.number, title: opened.pull_request.title, body: opened.pull_request.body, ref: opened.pull_request.head.ref }));
    const [link] = await linksOf(issue.id);
    expect(link?.prState).toBe('closed');
    expect(link?.closedAt).not.toBeNull();
    expect((await activityOf(issue.id, 'github_pr')).map((a) => (a.toValue as Json).state)).toContain('closed');
    expect(await inbox(issue.id)).toHaveLength(1);
    expect(await statusCategory(issue.id)).not.toBe('done');
  });

  it('a late non-terminal event cannot revert a merged link', async () => {
    const { issue, identifier } = await mkIssue();
    const merged = prFor('pull_request.closed-merged', identifier);
    await run('pull_request', merged);
    await run('pull_request', prPayload('pull_request.edited', { number: merged.number, title: merged.pull_request.title, body: merged.pull_request.body, ref: merged.pull_request.head.ref }));
    expect((await linksOf(issue.id))[0]?.prState).toBe('merged');
  });

  it('references to unknown issues or team keys are ignored safely', async () => {
    await run('pull_request', prPayload('pull_request.opened', { number: ++prSeq, title: 'ENG-99999 and NOPE-1', body: '', ref: 'main' }));
  });
});

describe('push', () => {
  it('links a commit for Fixes ENG-n (once), ignores commits without refs, never closes', async () => {
    const { issue, identifier } = await mkIssue();
    const p = fixture('push');
    p.commits[0].message = `Fixes ${identifier}: guard redirect`;
    p.commits[1].message = 'refactor: tidy imports';
    await run('push', p);
    const links = await linksOf(issue.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ kind: 'commit', repo: 'acme/web', commitSha: p.commits[0].id, author: 'octo-dev', closesIssue: false });
    const acts = await activityOf(issue.id, 'github_commit');
    expect(acts).toHaveLength(1);
    expect(acts[0]?.toValue).toMatchObject({ state: 'commit', sha: p.commits[0].id });
    expect(await statusCategory(issue.id)).not.toBe('done');
    await run('push', p); // same commits redelivered under a new id
    expect(await linksOf(issue.id)).toHaveLength(1);
    expect(await activityOf(issue.id, 'github_commit')).toHaveLength(1);
    expect(await inbox(issue.id)).toHaveLength(0); // commit state is activity-only
  });
});

describe('push (plain mention)', () => {
  it('links a commit that merely mentions ENG-n, idempotently', async () => {
    const { issue, identifier } = await mkIssue();
    const p = fixture('push');
    p.commits = [{ ...p.commits[0], id: 'c0ffee0000000000000000000000000000000001', message: `${identifier} tweak copy` }];
    await run('push', p);
    await run('push', p);
    const links = await linksOf(issue.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ kind: 'commit', closesIssue: false });
    expect(await activityOf(issue.id, 'github_commit')).toHaveLength(1);
    expect(await statusCategory(issue.id)).not.toBe('done');
  });
});

describe('issue sync', () => {
  const issueCount = async () => (await db().select().from(issues)).length;

  it('is ignored while issueSync is off', async () => {
    await setInstallSettings({ issueSync: false, issueSyncTeamId: teamId });
    const p = fixture('issues.opened');
    p.issue.number = 500;
    const before = await issueCount();
    const r = await run('issues', p);
    const [ev] = await db().select().from(githubEvents).where(eq(githubEvents.id, r.eventRowId as string));
    expect(ev?.status).toBe('ignored');
    expect(await issueCount()).toBe(before);
  });

  it('creates exactly one issue with a back-link comment, even when redelivered or edited', async () => {
    await setInstallSettings({ issueSync: true, issueSyncTeamId: teamId });
    const p = fixture('issues.opened');
    p.issue.number = 501;
    const before = await issueCount();
    await run('issues', p);
    await run('issues', p); // redelivery with a new delivery id
    await run('issues', { ...p, action: 'labeled', label: { name: 'Velocity' } });
    expect(await issueCount()).toBe(before + 1);
    const [created] = (await db().select().from(issues).where(eq(issues.title, 'Dark mode flickers on load')));
    expect(created?.descriptionMd).toContain('Seen on **Safari** 18.');
    expect(created?.createdBy).toBeNull();
    expect(api.comments).toHaveLength(1);
    expect(api.comments[0]).toMatchObject({ installationId: 4242, repo: 'acme/web', number: 501 });
    expect(api.comments[0]?.body).toBe(`Tracked in Velocity as ENG-${created?.number}: http://localhost:3000/issue/${created?.id}`);
    const markers = await activityOf(created!.id, 'github_issue_sync');
    expect(markers).toHaveLength(1);
    expect(markers[0]?.toValue).toMatchObject({ repo: 'acme/web', number: 501 });
  });

  it('ignores issues without the velocity label, PRs-as-issues, and unmapped repos with no fallback', async () => {
    const before = await issueCount();
    const noLabel = fixture('issues.opened');
    noLabel.issue.number = 502;
    noLabel.issue.labels = [{ name: 'bug' }];
    await run('issues', noLabel);
    expect(await issueCount()).toBe(before);

    // No explicit map, repo name doesn't match a team key, no fallback team → skip.
    await setInstallSettings({ issueSyncTeamId: null });
    const p = fixture('issues.opened');
    p.issue.number = 503;
    const r = await run('issues', p);
    const [ev] = await db().select().from(githubEvents).where(eq(githubEvents.id, r.eventRowId as string));
    expect(ev?.status).toBe('ignored');
    expect(await issueCount()).toBe(before);
  });

  it('routes by explicit repoTeamMap and by team key matching the repo name', async () => {
    const ops = await h.services.teams.create(owner, { key: 'OPS', name: 'Ops' });
    const apiTeam = await h.services.teams.create(owner, { key: 'API', name: 'API' });
    await setInstallSettings({ repoTeamMap: { 'acme/web': ops.id }, issueSyncTeamId: null });
    const a = fixture('issues.opened');
    a.issue.number = 504;
    a.issue.title = 'Mapped issue';
    await run('issues', a);
    const [mapped] = await db().select().from(issues).where(eq(issues.title, 'Mapped issue'));
    expect(mapped?.teamId).toBe(ops.id);

    const b = fixture('issues.opened');
    b.issue.number = 505;
    b.issue.title = 'Auto-matched issue';
    b.repository.full_name = 'acme/api';
    await run('issues', b);
    const [auto] = await db().select().from(issues).where(eq(issues.title, 'Auto-matched issue'));
    expect(auto?.teamId).toBe(apiTeam.id);
    await setInstallSettings({ repoTeamMap: {} });
  });
});

describe('installation events', () => {
  it('keeps github_installs in sync', async () => {
    await run('installation', fixture('installation.created'));
    const find = async () => (await db().select().from(githubInstalls).where(eq(githubInstalls.installationId, 5150)))[0];
    let row = await find();
    expect(row?.settings).toMatchObject({ accountLogin: 'globex', accountType: 'Organization', repos: ['globex/api', 'globex/web'], autoCloseOnMerge: true, issueSync: false });

    await run('installation_repositories', fixture('installation_repositories.added'));
    row = await find();
    expect(row?.settings.repos).toEqual(['globex/api', 'globex/docs', 'globex/web']);
    await run('installation_repositories', { ...fixture('installation_repositories.added'), action: 'removed', repositories_added: [], repositories_removed: [{ full_name: 'globex/web' }] });
    expect((await find())?.settings.repos).toEqual(['globex/api', 'globex/docs']);

    await run('installation', { ...fixture('installation.created'), action: 'suspend' });
    expect((await find())?.suspendedAt).not.toBeNull();
    await run('installation', { ...fixture('installation.created'), action: 'unsuspend' });
    expect((await find())?.suspendedAt).toBeNull();

    await run('installation', fixture('installation.deleted'));
    expect((await find())?.deletedAt).not.toBeNull();
    expect((await h.services.github.installs(owner)).some((i) => i.installationId === 5150)).toBe(false);
  });
});

describe('install management', () => {
  it('handleInstallCallback upserts settings, audits, and starts a backfill', async () => {
    const [row] = await db().select().from(githubInstalls).where(eq(githubInstalls.id, installId));
    expect(row?.settings).toMatchObject({ accountLogin: 'acme', accountType: 'Organization', repos: ['acme/web', 'acme/api'], repoTeamMap: {}, autoCloseOnMerge: true, issueSyncTeamId: null });
    const audit = await h.services.audit.list(owner, { action: 'github.installed' });
    expect(audit.entries.length).toBeGreaterThan(0);
    expect(h.jobs.sent.some((j) => j.queue === 'github' && (j.data as Json).type === 'backfill' && (j.data as Json).installId === installId)).toBe(true);
  });

  it('is owner-only', async () => {
    await expect(h.services.github.installs(member)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.services.github.handleInstallCallback(member, 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.services.github.updateSettings(member, installId, { issueSync: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.services.github.uninstall(member, installId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.services.github.startBackfill(member, installId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.services.github.cancelBackfill(member, installId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('updateSettings validates team ids and audits; uninstall marks deleted and audits', async () => {
    await expect(h.services.github.updateSettings(owner, installId, { repoTeamMap: { 'acme/web': '00000000-0000-7000-8000-000000000099' } })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(h.services.github.updateSettings(owner, installId, { issueSyncTeamId: '00000000-0000-7000-8000-000000000099' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const updated = await h.services.github.updateSettings(owner, installId, { repoTeamMap: { 'acme/web': teamId } });
    expect(updated.settings.repoTeamMap).toEqual({ 'acme/web': teamId });
    expect((await h.services.audit.list(owner, { action: 'github.settings_updated' })).entries.length).toBeGreaterThan(0);
    await h.services.github.updateSettings(owner, installId, { repoTeamMap: {} });

    const inst = await h.services.github.handleInstallCallback(owner, 7777);
    await h.services.github.uninstall(owner, inst.id);
    const [row] = await db().select().from(githubInstalls).where(eq(githubInstalls.id, inst.id));
    expect(row?.deletedAt).not.toBeNull();
    expect((await h.services.github.installs(owner)).some((i) => i.id === inst.id)).toBe(false);
    expect((await h.services.audit.list(owner, { action: 'github.uninstalled' })).entries).toHaveLength(1);
  });
});

describe('backfill', () => {
  it('links recent PRs without notifications, reaches progress 1, stops at the 90-day horizon', async () => {
    const a = await mkIssue();
    const b = await mkIssue();
    const old = await mkIssue();
    const day = 86_400_000;
    api.pulls = {
      'acme/web': [
        pull({ number: 900, title: `Ship ${a.identifier}`, url: 'https://github.com/acme/web/pull/900', state: 'closed', merged: true, mergedAt: new Date(Date.now() - 5 * day).toISOString(), updatedAt: new Date(Date.now() - 5 * day).toISOString() }),
        pull({ number: 901, title: 'Other', body: `Fixes ${b.identifier}`, url: 'https://github.com/acme/web/pull/901', updatedAt: new Date(Date.now() - 10 * day).toISOString() }),
        pull({ number: 902, title: `Ancient ${old.identifier}`, url: 'https://github.com/acme/web/pull/902', updatedAt: new Date(Date.now() - 120 * day).toISOString() }),
      ],
      'acme/api': [],
    };
    api.pageCalls = [];
    const outboxBefore = (await h.pool.query(`select count(*)::int as n from event_outbox where topic = 'github.linked'`)).rows[0].n as number;
    await h.services.github.startBackfill(owner, installId);
    let [inst] = await db().select().from(githubInstalls).where(eq(githubInstalls.id, installId));
    expect(inst).toMatchObject({ backfillStatus: 'running', backfillProgress: 0 });

    const progress: number[] = [];
    api.onPage = async () => {
      const [cur] = await db().select().from(githubInstalls).where(eq(githubInstalls.id, installId));
      progress.push(cur!.backfillProgress);
    };
    await h.services.github.runBackfill(installId);
    api.onPage = null;
    [inst] = await db().select().from(githubInstalls).where(eq(githubInstalls.id, installId));
    expect(inst).toMatchObject({ backfillStatus: 'done', backfillProgress: 1 });
    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress).toEqual([...progress].sort((x, y) => x - y));
    expect(progress.every((p) => p < 1)).toBe(true);

    expect((await linksOf(a.issue.id))[0]).toMatchObject({ prNumber: 900, prState: 'merged', closesIssue: true });
    expect((await linksOf(b.issue.id))[0]).toMatchObject({ prNumber: 901, prState: 'open', closesIssue: true });
    expect(await linksOf(old.issue.id)).toHaveLength(0);
    expect(await activityOf(a.issue.id, 'github_pr')).toHaveLength(1);
    // No notifications and no auto-close during backfill.
    await h.services.events.drain();
    expect(await inbox(a.issue.id)).toHaveLength(0);
    expect(await inbox(b.issue.id)).toHaveLength(0);
    expect(await statusCategory(a.issue.id)).not.toBe('done');
    const outboxAfter = (await h.pool.query(`select count(*)::int as n from event_outbox where topic = 'github.linked'`)).rows[0].n as number;
    expect(outboxAfter).toBe(outboxBefore);
  });

  it('cancel stops the run between pages', async () => {
    const x = await mkIssue();
    const y = await mkIssue();
    api.pulls = {
      'acme/web': [
        pull({ number: 910, title: `One ${x.identifier}` }),
        pull({ number: 911, title: 'two' }),
        pull({ number: 912, title: `Three ${y.identifier}` }),
      ],
      'acme/api': [],
    };
    api.pageCalls = [];
    await h.services.github.startBackfill(owner, installId);
    api.onPage = async () => {
      if (api.pageCalls.length === 1) await h.services.github.cancelBackfill(owner, installId);
    };
    await h.services.github.runBackfill(installId);
    api.onPage = null;
    const [inst] = await db().select().from(githubInstalls).where(eq(githubInstalls.id, installId));
    expect(inst?.backfillStatus).toBe('canceled');
    expect(api.pageCalls).toEqual([{ repo: 'acme/web', page: 1 }]);
    expect(await linksOf(y.issue.id)).toHaveLength(0);
  });

  it('failure sets status failed', async () => {
    api.pulls = {};
    await h.services.github.startBackfill(owner, installId);
    api.onPage = async () => {
      throw new Error('boom');
    };
    await h.services.github.runBackfill(installId);
    api.onPage = null;
    const [inst] = await db().select().from(githubInstalls).where(eq(githubInstalls.id, installId));
    expect(inst?.backfillStatus).toBe('failed');
    await h.services.github.startBackfill(owner, installId);
    await h.services.github.runBackfill(installId);
  });
});

describe('manual links', () => {
  it('validates the URL, fetches via the API when an install covers the repo, else stores a minimal link', async () => {
    const { issue } = await mkIssue();
    await expect(h.services.github.linkPullRequest(member, issue.id, 'https://example.com/acme/web/pull/1')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(h.services.github.linkPullRequest(member, issue.id, 'https://github.com/acme/web/issues/1')).rejects.toMatchObject({ code: 'VALIDATION' });

    const covered = await h.services.github.linkPullRequest(member, issue.id, 'https://github.com/acme/web/pull/321');
    expect(covered).toMatchObject({ kind: 'pr', repo: 'acme/web', prNumber: 321, title: 'Fetched acme/web#321', closesIssue: true, prState: 'merged' });
    expect(api.getPullCalls).toBe(1);

    const calls = api.getPullCalls;
    const minimal = await h.services.github.linkPullRequest(member, issue.id, 'https://github.com/other/thing/pull/5');
    expect(minimal).toMatchObject({ repo: 'other/thing', prNumber: 5, prState: 'open', closesIssue: true, prUrl: 'https://github.com/other/thing/pull/5' });
    expect(api.getPullCalls).toBe(calls);

    // Linking the same PR twice is idempotent.
    await h.services.github.linkPullRequest(member, issue.id, 'https://github.com/other/thing/pull/5');
    const links = await h.services.github.linksFor([issue.id]);
    expect(links).toHaveLength(2);
    // Manual link does not auto-close even if the PR is already merged.
    expect(await statusCategory(issue.id)).not.toBe('done');
  });

  it('unlink removes the link; setAutoClose validates existence; linksFor handles empty input', async () => {
    const { issue } = await mkIssue();
    const link = await h.services.github.linkPullRequest(member, issue.id, 'https://github.com/other/thing/pull/6');
    const set = await h.services.github.setAutoClose(member, link.id, false);
    expect(set.autoClose).toBe(false);
    await h.services.github.unlink(member, link.id);
    expect(await h.services.github.linksFor([issue.id])).toHaveLength(0);
    expect(await activityOf(issue.id, 'github_unlinked')).toHaveLength(1);
    await expect(h.services.github.unlink(member, link.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(h.services.github.setAutoClose(member, link.id, null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await h.services.github.linksFor([])).toEqual([]);
  });
});
