import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportBundle, ImportDryRunReport, ImportMapping } from '@velocity/schema';
import { generateLinearCsv } from '../../../importers/scripts/generate-linear-csv';
import type { Harness } from '../helpers/harness';
import { addMember, createHarness, setupOwner } from '../helpers/harness';
import type { ImportRunRow, ServiceActor } from '../../src/index';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'importers', 'fixtures');
const fixture = (n: string): string => readFileSync(join(fixtures, n), 'utf8');

interface Ctx {
  h: Harness;
  owner: ServiceActor;
  member: ServiceActor;
}

async function start(): Promise<Ctx> {
  const h = await createHarness();
  const owner = await setupOwner(h);
  const member = await addMember(h, owner, 'mia');
  return { h, owner, member };
}

async function q<T = Record<string, unknown>>(h: Harness, text: string, params: unknown[] = []): Promise<T[]> {
  return (await h.pool.query(text, params)).rows as T[];
}
async function count(h: Harness, table: string, where = 'true'): Promise<number> {
  return Number((await q<{ n: string }>(h, `select count(*) as n from ${table} where ${where}`))[0]!.n);
}

const dryReport = (r: ImportRunRow): ImportDryRunReport => r.report as ImportDryRunReport;
const mappingOf = (r: ImportRunRow): ImportMapping => r.mapping as ImportMapping;

/** dry-run → commit → run the queued job. */
async function importAll(c: Ctx, run: ImportRunRow): Promise<ImportRunRow> {
  const s = c.h.services.importer;
  await s.dryRun(c.owner, run.id);
  await s.commit(c.owner, run.id);
  await s.runCommit(run.id);
  return (await s.get(c.owner, run.id))!;
}

interface Committed extends ImportDryRunReport {
  dryRun: ImportDryRunReport;
  result: { counts: Record<string, number>; warnings: { code: string }[] };
}

describe('linear csv fixture', () => {
  let c: Ctx;
  let run: ImportRunRow;
  let done: ImportRunRow;
  let dry: ImportDryRunReport;
  beforeAll(async () => {
    c = await start();
    await c.h.services.teams.create(c.owner, { key: 'XTRA', name: 'Extra' });
  });
  afterAll(async () => c.h.close());

  it('creates a run with a sane suggested mapping and no bundle in reads', async () => {
    run = await c.h.services.importer.createRunFromCsv(c.owner, { source: 'linear', csv: fixture('linear-export.csv'), fileName: 'linear-export.csv' });
    expect(run.status).toBe('mapping');
    expect(run.source).toBe('linear');
    expect(run.suggestedMapping).toEqual(run.mapping);
    const m = mappingOf(run);
    expect(Object.values(m.teams).map((t) => (t.mode === 'create' ? t.key : 'existing')).sort()).toEqual(['DES', 'ENG', 'OPS']);
    expect(m.include).toEqual({ projects: true, cycles: true, comments: true, relations: true, archived: false });
    const read = await c.h.services.importer.get(c.owner, run.id);
    expect(read!.config).toMatchObject({ counts: { issues: 21 }, teams: expect.any(Array), statuses: expect.any(Array), users: expect.any(Array) });
    expect(read!.config).not.toHaveProperty('issues');
    const audit = await q(c.h, `select * from audit_log where action = 'import.started'`);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain('Set up CI pipeline');
  });

  it('refuses to commit before a dry run', async () => {
    await expect(c.h.services.importer.commit(c.owner, run.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('dry-run writes no domain data and reports counts', async () => {
    const r = await c.h.services.importer.dryRun(c.owner, run.id);
    expect(r.status).toBe('ready');
    dry = dryReport(r);
    expect(await count(c.h, 'issues')).toBe(0);
    expect(await count(c.h, 'teams')).toBe(1);
    expect(dry.counts.teamsToCreate).toBe(3);
    expect(dry.counts.issues).toBe(20); // fixture minus invalid/duplicate rows and archived ENG-8
    expect(dry.counts.skippedIssues).toBeGreaterThanOrEqual(1);
    expect(dry.unmapped.users.length).toBeGreaterThan(0);
    expect(dry.unmapped.statuses.length).toBeGreaterThanOrEqual(0);
  });

  it('commit queues the job; runCommit creates exactly what the dry-run predicted', async () => {
    const r = await c.h.services.importer.commit(c.owner, run.id);
    expect(r.status).toBe('committing');
    expect(c.h.jobs.sent.at(-1)).toMatchObject({ queue: 'importers', data: { type: 'commit', runId: run.id } });
    await c.h.services.importer.runCommit(run.id);
    done = (await c.h.services.importer.get(c.owner, run.id))!;
    expect(done.status).toBe('completed');
    expect(done.progress).toBe(1);
    const rep = done.report as Committed;
    expect(rep.counts).toEqual(rep.dryRun.counts);
    expect(rep.dryRun).toEqual(dry);
    expect(rep.result.counts.issuesFailed).toBe(0);
    expect(done.committedCount).toBe(dry.counts.issues);
    const { counts } = rep.result;
    expect(counts.teams).toBe(dry.counts.teamsToCreate);
    expect(counts.statuses).toBe(dry.counts.statusesToCreate);
    expect(counts.labels).toBe(dry.counts.labelsToCreate);
    expect(counts.projects).toBe(dry.counts.projectsToCreate);
    expect(counts.cycles).toBe(dry.counts.cyclesToCreate);
    expect(counts.comments).toBe(dry.counts.comments);
    expect(counts.relations).toBe(dry.counts.relations);
    // …and the database agrees.
    expect(await count(c.h, 'issues')).toBe(dry.counts.issues);
    expect(await count(c.h, 'teams')).toBe(1 + dry.counts.teamsToCreate);
    expect(await count(c.h, 'projects')).toBe(dry.counts.projectsToCreate);
    expect(await count(c.h, 'cycles')).toBe(dry.counts.cyclesToCreate);
    expect(await count(c.h, 'issue_relations')).toBe(dry.counts.relations);
  });

  it('verifies imported entities', async () => {
    const h = c.h;
    const teamRows = await q<{ key: string; n: number }>(h, `select t.key, count(i.id)::int as n from teams t left join issues i on i.team_id = t.id group by t.key`);
    const byKey = Object.fromEntries(teamRows.map((t) => [t.key, t.n]));
    expect(byKey.ENG).toBeGreaterThan(0);
    expect(byKey.DES).toBe(5);
    expect(byKey.OPS).toBe(6);
    // gapless numbering per team
    for (const t of ['ENG', 'DES', 'OPS']) {
      const nums = await q<{ number: number }>(h, `select i.number from issues i join teams t on t.id = i.team_id where t.key = $1 order by i.number`, [t]);
      expect(nums.map((x) => x.number)).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
    }
    // titles, quotes and unicode survive; lifecycle timestamps and createdAt are preserved
    const unicode = await q<{ title: string }>(h, `select title from issues where title like 'Unicode:%'`);
    expect(unicode[0]!.title).toBe('Unicode: café ☕ 日本語');
    const ci = await q<{ created_at: Date; completed_at: Date | null; identifier: string; status: string; cat: string }>(
      h,
      `select i.created_at, i.completed_at, t.key || '-' || i.number as identifier, s.name as status, s.category as cat
         from issues i join teams t on t.id = i.team_id join statuses s on s.id = i.status_id where i.title = 'Set up CI pipeline'`,
    );
    expect(ci[0]!.identifier).toBe('ENG-1');
    expect(ci[0]!.created_at.toISOString()).toBe('2024-03-01T10:00:00.000Z');
    expect(ci[0]!.completed_at).not.toBeNull();
    expect(ci[0]!.cat).toBe('done');
    // the unusual workflow state became a new status
    const weird = await q<{ name: string }>(h, `select s.name from statuses s join teams t on t.id = s.team_id where s.name = 'Waiting on legal'`);
    expect(weird).toHaveLength(1);
    // labels + projects + cycles
    expect(await count(h, 'labels', `lower(name) in ('bug','feature','security')`)).toBe(3);
    expect(await count(h, 'projects', `name in ('Platform','Brand','Infra')`)).toBe(3);
    const closed = await q<{ closed_at: Date | null; stats: { scopeCount: number } | null }>(h, `select closed_at, stats from cycles`);
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.every((x) => x.closed_at !== null && x.stats !== null)).toBe(true);
    // parents: ENG-4's parent is ENG-3
    const parent = await q<{ child: string; parent: string }>(
      h,
      `select tc.key || '-' || c.number as child, tp.key || '-' || p.number as parent
         from issues c join issues p on p.id = c.parent_id join teams tc on tc.id = c.team_id join teams tp on tp.id = p.team_id where c.title = 'Sub-task: write rate limit tests'`,
    );
    expect(parent[0]).toEqual({ child: 'ENG-4', parent: 'ENG-3' });
    expect(await count(h, 'issues', 'parent_id is not null')).toBeGreaterThanOrEqual(5);
    // activity is attributed to the import actor
    const kinds = await q<{ actor_kind: string }>(h, `select distinct actor_kind from issue_activity`);
    expect(kinds.map((k) => k.actor_kind)).toEqual(['import']);
    // audit
    expect(await count(h, 'audit_log', `action = 'import.committed'`)).toBe(1);
    // events
    expect(await count(h, 'event_outbox', `topic = 'import.completed'`)).toBe(1);
    expect(await count(h, 'event_outbox', `topic = 'import.progress'`)).toBeGreaterThan(0);
  });

  it('re-running runCommit is a no-op', async () => {
    const before = [await count(c.h, 'issues'), await count(c.h, 'comments'), await count(c.h, 'issue_relations'), await count(c.h, 'import_items'), await count(c.h, 'event_outbox')];
    await c.h.services.importer.runCommit(run.id);
    const after = [await count(c.h, 'issues'), await count(c.h, 'comments'), await count(c.h, 'issue_relations'), await count(c.h, 'import_items'), await count(c.h, 'event_outbox')];
    expect(after).toEqual(before);
    // Forcing the status back to 'committing' (a redelivered job) must also create nothing new.
    await c.h.pool.query(`update import_runs set status = 'committing' where id = $1`, [run.id]);
    await c.h.services.importer.runCommit(run.id);
    expect(await count(c.h, 'issues')).toBe(before[0]);
    expect(await count(c.h, 'import_items')).toBe(before[3]);
    expect((await c.h.services.importer.get(c.owner, run.id))!.status).toBe('completed');
  });

  it('lists runs newest first', async () => {
    const list = await c.h.services.importer.list(c.owner);
    expect(list[0]!.id).toBe(run.id);
    expect(list[0]!.config).toMatchObject({ counts: { issues: 21 }, teams: expect.any(Array), statuses: expect.any(Array), users: expect.any(Array) });
    expect(list[0]!.config).not.toHaveProperty('issues');
  });
});

describe('1000-row linear import', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await start();
  });
  afterAll(async () => c.h.close());

  it('imports 1000 issues with gapless numbers and full progress', async () => {
    const csv = generateLinearCsv(1000);
    const run = await c.h.services.importer.createRunFromCsv(c.owner, { source: 'linear', csv, fileName: 'big.csv' });
    const dry = dryReport(await c.h.services.importer.dryRun(c.owner, run.id));
    expect(dry.counts.issues).toBe(1000);
    await c.h.services.importer.commit(c.owner, run.id);
    const t0 = performance.now();
    await c.h.services.importer.runCommit(run.id);
    const ms = performance.now() - t0;
    console.log(`[importer] 1000-issue commit took ${(ms / 1000).toFixed(2)}s`);
    const done = (await c.h.services.importer.get(c.owner, run.id))!;
    expect(done.status).toBe('completed');
    expect(done.progress).toBe(1);
    expect(done.committedCount).toBe(1000);
    expect(await count(c.h, 'issues')).toBe(1000);
    const rep = done.report as Committed;
    expect(rep.counts).toEqual(rep.dryRun.counts);
    for (const t of ['ENG', 'DES', 'OPS']) {
      const nums = await q<{ number: number }>(c.h, `select i.number from issues i join teams t on t.id = i.team_id where t.key = $1 order by i.number`, [t]);
      expect(nums.length).toBeGreaterThan(300);
      expect(nums.map((x) => x.number)).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
    }
    const progressEvents = await q<{ payload: { progress: number } }>(c.h, `select payload from event_outbox where topic = 'import.progress' order by id`);
    expect(progressEvents.length).toBeGreaterThan(2);
    expect(progressEvents.at(-1)!.payload.progress).toBe(1);
  }, 180_000);
});

describe('resumability', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await start();
  });
  afterAll(async () => c.h.close());

  it('resumes after a failure between chunks without duplicates', async () => {
    const s = c.h.services.importer;
    const run = await s.createRunFromCsv(c.owner, { source: 'linear', csv: generateLinearCsv(1000) });
    const summary = run.config as { teams: unknown[]; statuses: unknown[]; users: unknown[]; counts: { issues: number }; issues?: unknown[] };
    expect(summary.counts.issues).toBe(1000);
    expect(summary.teams).toHaveLength(3);
    expect(summary.statuses.length).toBeGreaterThan(0);
    expect(summary.users.length).toBeGreaterThan(0);
    expect(summary.issues).toBeUndefined();
    const dry = dryReport(await s.dryRun(c.owner, run.id));
    await s.commit(c.owner, run.id);

    s.failAfterChunks = 1;
    await expect(s.runCommit(run.id)).rejects.toThrow(/Injected failure/);
    s.failAfterChunks = null;

    const failed = (await s.get(c.owner, run.id))!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/Injected failure/);
    expect(failed.committedCount).toBe(500);
    expect(failed.progress).toBeGreaterThan(0.05);
    expect(failed.progress).toBeLessThan(0.8);
    expect(await count(c.h, 'issues')).toBe(500);
    expect(await count(c.h, 'comments')).toBe(0);

    // A failed run can't be re-dry-run, but can be re-committed.
    await expect(s.dryRun(c.owner, run.id)).rejects.toMatchObject({ code: 'VALIDATION' });
    const again = await s.commit(c.owner, run.id);
    expect(again.status).toBe('committing');
    expect(again.committedCount).toBe(500);
    await s.runCommit(run.id);

    const done = (await s.get(c.owner, run.id))!;
    expect(done.status).toBe('completed');
    expect(done.error).toBeNull();
    expect(await count(c.h, 'issues')).toBe(1000);
    expect(await count(c.h, 'import_items', `kind = 'issue'`)).toBe(1000);
    expect(await count(c.h, 'teams')).toBe(3);
    expect(await count(c.h, 'projects')).toBe(dry.counts.projectsToCreate);
    expect(await count(c.h, 'cycles')).toBe(dry.counts.cyclesToCreate);
    expect(await count(c.h, 'issue_relations')).toBe(dry.counts.relations);
    const rep = done.report as Committed;
    expect(rep.counts).toEqual(rep.dryRun.counts);
    const dupes = await q(c.h, `select team_id, number from issues group by 1,2 having count(*) > 1`);
    expect(dupes).toHaveLength(0);
  }, 180_000);

  it('cancel stops a committing run', async () => {
    const s = c.h.services.importer;
    const run = await s.createRunFromCsv(c.owner, { source: 'linear', csv: fixture('linear-export.csv') });
    await s.dryRun(c.owner, run.id);
    await s.commit(c.owner, run.id);
    const canceled = await s.cancel(c.owner, run.id);
    expect(canceled.status).toBe('canceled');
    const before = await count(c.h, 'teams');
    await s.runCommit(run.id);
    expect(await count(c.h, 'teams')).toBe(before);
    await expect(s.commit(c.owner, run.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('jira fixture', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await start();
  });
  afterAll(async () => c.h.close());

  it('imports end to end', async () => {
    const s = c.h.services.importer;
    const run = await s.createRunFromCsv(c.owner, { source: 'jira', csv: fixture('jira-export.csv'), fileName: 'jira-export.csv' });
    expect(run.source).toBe('jira');
    const done = await importAll(c, run);
    expect(done.status).toBe('completed');
    const rep = done.report as Committed;
    expect(rep.counts).toEqual(rep.dryRun.counts);
    expect(rep.dryRun.counts.issues).toBeGreaterThan(10);
    expect(await count(c.h, 'issues')).toBe(rep.dryRun.counts.issues);
    expect(await count(c.h, 'comments', `source = 'import'`)).toBe(rep.dryRun.counts.comments);
    expect(rep.dryRun.counts.comments).toBeGreaterThan(0);
    // Unmapped authors keep their display name and have no member.
    const named = await q<{ author_name: string | null; author_id: string | null }>(c.h, `select author_name, author_id from comments`);
    expect(named.every((x) => x.author_id === null && x.author_name)).toBe(true);
    expect(await count(c.h, 'issue_relations')).toBe(rep.dryRun.counts.relations);
    // Issues keep their Jira creation date.
    const web1 = await q<{ created_at: Date }>(c.h, `select created_at from issues where title = 'Set up project skeleton'`);
    expect(web1[0]!.created_at.getUTCFullYear()).toBe(2024);
  });
});

describe('mapping onto existing data', () => {
  let c: Ctx;
  let teamId: string;
  beforeAll(async () => {
    c = await start();
    const team = await c.h.services.teams.create(c.owner, { key: 'ENG', name: 'Engineering' });
    teamId = team.id;
    for (let i = 0; i < 3; i++) await c.h.services.issues.create(c.owner, { teamId, title: `Existing ${i}` });
    await c.h.services.projects.create(c.owner, { name: 'platform' });
    await c.h.pool.query(`update users set email = 'carol@example.com' where id = $1`, [c.member.userId]);
  });
  afterAll(async () => c.h.close());

  it('numbers after existing issues, reuses labels/projects/statuses, maps users by email', async () => {
    const s = c.h.services.importer;
    const run = await s.createRunFromCsv(c.owner, { source: 'linear', csv: fixture('linear-export.csv') });
    const m = mappingOf(run);
    const eng = Object.values(m.teams).find((t) => t.mode === 'existing');
    expect(eng).toMatchObject({ mode: 'existing', teamId });
    expect(Object.values(m.users).filter((u) => u?.userId === c.member.userId)).toHaveLength(1);
    const dry = dryReport(await s.dryRun(c.owner, run.id));
    expect(dry.counts.teamsToCreate).toBe(2);
    expect(dry.counts.projectsToCreate).toBe(2); // "Platform" exists as "platform"
    const labelsBefore = await count(c.h, 'labels');
    const statusesBefore = await count(c.h, 'statuses');
    await s.commit(c.owner, run.id);
    await s.runCommit(run.id);
    const done = (await s.get(c.owner, run.id))!;
    const rep = done.report as Committed;
    expect(rep.counts).toEqual(rep.dryRun.counts);
    expect(await count(c.h, 'labels')).toBe(labelsBefore + dry.counts.labelsToCreate);
    expect(await count(c.h, 'statuses')).toBe(statusesBefore + dry.counts.statusesToCreate + dry.counts.teamsToCreate * 5);
    expect(await count(c.h, 'projects')).toBe(3);
    const first = await q<{ number: number }>(c.h, `select number from issues where title = 'Set up CI pipeline'`);
    expect(first[0]!.number).toBe(4);
    const nums = await q<{ number: number }>(c.h, `select number from issues where team_id = $1 order by number`, [teamId]);
    expect(nums.map((n) => n.number)).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
    const assigned = await q<{ title: string }>(c.h, `select title from issues where assignee_id = $1`, [c.member.userId]);
    expect(assigned.map((a) => a.title)).toContain('Sub-task: write rate limit tests');
    // Existing "security" label was reused, not duplicated.
    expect(await count(c.h, 'labels', `lower(name) = 'security'`)).toBe(1);
  });
});

describe('include toggles', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await start();
  });
  afterAll(async () => c.h.close());

  it('comments/relations/projects/cycles off and archived on change the plan and the result', async () => {
    const s = c.h.services.importer;
    const csv = fixture('jira-export.csv');
    const base = await s.createRunFromCsv(c.owner, { source: 'jira', csv });
    const baseDry = dryReport(await s.dryRun(c.owner, base.id));
    expect(baseDry.counts.comments).toBeGreaterThan(0);
    expect(baseDry.counts.relations).toBeGreaterThan(0);

    const run = await s.createRunFromCsv(c.owner, { source: 'jira', csv });
    const m = mappingOf(run);
    const updated = await s.updateMapping(c.owner, run.id, { ...m, include: { ...m.include, comments: false, relations: false, projects: false, cycles: false } });
    expect(updated.status).toBe('mapping');
    const dry = dryReport(await s.dryRun(c.owner, run.id));
    expect(dry.counts.comments).toBe(0);
    expect(dry.counts.relations).toBe(0);
    expect(dry.counts.projectsToCreate).toBe(0);
    expect(dry.counts.cyclesToCreate).toBe(0);
    expect(dry.counts.issues).toBe(baseDry.counts.issues);
    // Changing the mapping again invalidates the report and requires a new dry run.
    const reset = await s.updateMapping(c.owner, run.id, { ...m, include: { ...m.include, comments: false, relations: false, projects: false, cycles: false } });
    expect(reset.report).toBeNull();
    await expect(s.commit(c.owner, run.id)).rejects.toMatchObject({ code: 'VALIDATION' });
    await s.dryRun(c.owner, run.id);
    await s.commit(c.owner, run.id);
    await s.runCommit(run.id);
    expect(await count(c.h, 'comments')).toBe(0);
    expect(await count(c.h, 'issue_relations')).toBe(0);
    expect(await count(c.h, 'projects')).toBe(0);
    expect(await count(c.h, 'cycles')).toBe(0);
    expect(await count(c.h, 'issues')).toBe(dry.counts.issues);
  });

  it('archived issues are skipped unless included', async () => {
    const s = c.h.services.importer;
    const csv = fixture('linear-export.csv');
    const a = await s.createRunFromCsv(c.owner, { source: 'linear', csv });
    const off = dryReport(await s.dryRun(c.owner, a.id));
    const b = await s.createRunFromCsv(c.owner, { source: 'linear', csv });
    const m = mappingOf(b);
    await s.updateMapping(c.owner, b.id, { ...m, include: { ...m.include, archived: true } });
    const on = dryReport(await s.dryRun(c.owner, b.id));
    expect(on.counts.issues).toBe(off.counts.issues + 1);
    expect(on.counts.skippedIssues).toBe(off.counts.skippedIssues - 1);
  });
});

describe('permissions and validation', () => {
  let c: Ctx;
  let run: ImportRunRow;
  beforeAll(async () => {
    c = await start();
    run = await c.h.services.importer.createRunFromCsv(c.owner, { source: 'linear', csv: fixture('linear-export.csv') });
  });
  afterAll(async () => c.h.close());

  it('is owner-only', async () => {
    const s = c.h.services.importer;
    const forbidden = { code: 'FORBIDDEN' };
    await expect(s.createRun(c.member, { source: 'linear', bundle: {} })).rejects.toMatchObject(forbidden);
    await expect(s.createRunFromCsv(c.member, { source: 'linear', csv: 'a' })).rejects.toMatchObject(forbidden);
    await expect(s.createRunFromApi(c.member, { source: 'github', token: 't', repos: ['a/b'] })).rejects.toMatchObject(forbidden);
    await expect(s.updateMapping(c.member, run.id, {})).rejects.toMatchObject(forbidden);
    await expect(s.dryRun(c.member, run.id)).rejects.toMatchObject(forbidden);
    await expect(s.commit(c.member, run.id)).rejects.toMatchObject(forbidden);
    await expect(s.cancel(c.member, run.id)).rejects.toMatchObject(forbidden);
    await expect(s.get(c.member, run.id)).rejects.toMatchObject(forbidden);
    await expect(s.list(c.member)).rejects.toMatchObject(forbidden);
  });

  it('rejects malformed bundles', async () => {
    await expect(c.h.services.importer.createRun(c.owner, { source: 'linear', bundle: { nope: true } })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await count(c.h, 'import_runs')).toBe(1);
  });

  it('validates mapping updates', async () => {
    const s = c.h.services.importer;
    const m = mappingOf(run);
    const teamExt = Object.keys(m.teams)[0]!;
    const [other] = Object.keys(m.teams).slice(1);
    const bad = (mapping: unknown) => expect(s.updateMapping(c.owner, run.id, mapping)).rejects.toMatchObject({ code: 'VALIDATION' });
    await bad('nope');
    await bad({ ...m, include: { projects: true } });
    await bad({ ...m, teams: { ...m.teams, [teamExt]: { mode: 'create', key: 'bad key', name: 'X' } } });
    await bad({ ...m, teams: { ...m.teams, [teamExt]: { mode: 'create', key: '1BAD', name: 'X' } } });
    await bad({ ...m, teams: { ...m.teams, [teamExt]: { mode: 'existing', teamId: '00000000-0000-4000-8000-000000000000' } } });
    // duplicate new keys
    await bad({ ...m, teams: { ...m.teams, [teamExt]: { mode: 'create', key: 'DUP', name: 'A' }, [other!]: { mode: 'create', key: 'DUP', name: 'B' } } });
    // unknown team ext id / missing team
    await bad({ ...m, teams: { ...m.teams, ghost: { mode: 'create', key: 'GH', name: 'Ghost' } } });
    const { [teamExt]: _drop, ...rest } = m.teams;
    void _drop;
    await bad({ ...m, teams: rest });
    // unknown user
    await bad({ ...m, users: { ...m.users, x: { userId: '00000000-0000-4000-8000-000000000000' } } });
    // status that belongs to a different team
    const eng = await c.h.services.teams.create(c.owner, { key: 'ENG', name: 'Engineering' });
    const des = await c.h.services.teams.create(c.owner, { key: 'DESX', name: 'Other' });
    const desStatus = (await c.h.services.teams.statuses(des.id))[0]!;
    const statusKey = Object.keys(m.statuses).find((k) => k.startsWith(`${teamExt}::`))!;
    await bad({
      ...m,
      teams: { ...m.teams, [teamExt]: { mode: 'existing', teamId: eng.id } },
      statuses: { ...m.statuses, [statusKey]: { mode: 'existing', statusId: desStatus.id } },
    });
    // collision with an existing team key
    await bad({ ...m, teams: { ...m.teams, [teamExt]: { mode: 'create', key: 'ENG', name: 'X' } } });
    // a valid change works and keeps the run in 'mapping'
    // (the suggested keys now collide with the teams created above, so give every new team a fresh key)
    const renamed = Object.fromEntries(Object.keys(m.teams).map((k, i) => [k, { mode: 'create' as const, key: i === 0 ? 'zeta' : `NEW${i}`, name: `Team ${i}` }]));
    const ok = await s.updateMapping(c.owner, run.id, { ...m, teams: renamed });
    expect(mappingOf(ok).teams[teamExt]).toEqual({ mode: 'create', key: 'ZETA', name: 'Team 0' });
    // …and is rejected once the run is committing
    const committed = await s.createRunFromCsv(c.owner, { source: 'linear', csv: fixture('linear-export.csv') });
    await s.dryRun(c.owner, committed.id);
    await s.commit(c.owner, committed.id);
    await expect(s.updateMapping(c.owner, committed.id, mappingOf(committed))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(s.updateMapping(c.owner, '00000000-0000-4000-8000-000000000000', m)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('secrets', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await start();
  });
  afterAll(async () => c.h.close());

  it('never stores api keys or tokens', async () => {
    const fx = JSON.parse(fixture('linear-api-responses.json')) as Record<string, unknown>;
    const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const seen: string[] = [];
    const mock = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(String((init?.headers as Record<string, string>).Authorization));
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      for (const f of ['teams', 'users', 'issueLabels', 'projects', 'cycles']) if (body.query.includes(`${f}(first`)) return json(fx[f]);
      if (body.query.includes('issues(first')) return json(body.variables.after ? fx['issues-page2'] : fx['issues-page1']);
      return json({ errors: [{ message: 'unexpected' }] });
    }) as typeof fetch;
    const s = c.h.services.importer;
    s.fetchImpl = mock;
    const key = 'lin_api_SUPER_SECRET_123';
    const run = await s.createRunFromApi(c.owner, { source: 'linear', apiKey: key });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((x) => x === key)).toBe(true);
    await s.dryRun(c.owner, run.id);
    await s.commit(c.owner, run.id);
    await s.runCommit(run.id);
    for (const table of ['import_runs', 'import_items', 'audit_log', 'event_outbox']) {
      expect(JSON.stringify(await q(c.h, `select * from ${table}`))).not.toContain('SUPER_SECRET');
    }
    expect(JSON.stringify(c.h.jobs.sent)).not.toContain('SUPER_SECRET');
    expect((await s.get(c.owner, run.id))!.status).toBe('completed');

    // Upstream errors can't leak the key either.
    const leaky = (async () => {
      throw new Error(`boom for ${key}`);
    }) as unknown as typeof fetch;
    s.fetchImpl = leaky;
    const err = await s.createRunFromApi(c.owner, { source: 'linear', apiKey: key }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('SUPER_SECRET');
    s.fetchImpl = undefined;
  });
});

describe('bundle helper', () => {
  it('imports a hand-built bundle through createRun', async () => {
    const c = await start();
    try {
      const bundle: ImportBundle = {
        source: 'github',
        teams: [{ externalId: 'a/b', key: 'AB', name: 'AB repo' }],
        statuses: [
          { teamExternalId: 'a/b', name: 'Open', category: 'todo' },
          { teamExternalId: 'a/b', name: 'Mystery', category: null },
        ],
        users: [],
        labels: [{ name: 'area/x', group: 'Area' }],
        projects: [],
        cycles: [],
        issues: [
          { externalId: 'a/b#1', teamExternalId: 'a/b', title: 'One', statusName: 'Open', labelNames: ['area/x'], relations: [], comments: [], attachments: [], parentExternalId: 'a/b#99' },
          { externalId: 'a/b#2', teamExternalId: 'a/b', title: 'Two', statusName: 'Mystery', labelNames: [], relations: [{ type: 'blocks', targetExternalId: 'a/b#1' }], comments: [{ bodyMd: 'hi', authorName: 'ghost' }], attachments: [], parentExternalId: 'a/b#1' },
        ],
        warnings: [{ code: 'x', message: 'from importer' }],
      };
      const run = await c.h.services.importer.createRun(c.owner, { source: 'github', bundle });
      const dry = dryReport(await c.h.services.importer.dryRun(c.owner, run.id));
      expect(dry.counts).toMatchObject({ teamsToCreate: 1, labelsToCreate: 2, issues: 2, comments: 1, relations: 1 });
      expect(dry.unmapped.statuses).toEqual(['a/b::Mystery']);
      expect(dry.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['x', 'parent_outside_import']));
      await c.h.services.importer.commit(c.owner, run.id);
      await c.h.services.importer.runCommit(run.id);
      const rep = ((await c.h.services.importer.get(c.owner, run.id))!.report) as Committed;
      expect(rep.counts).toEqual(dry.counts);
      expect(await count(c.h, 'issues', 'parent_id is not null')).toBe(1);
      // GitHub issues carry no priority: they must land as "No priority" (4), never Urgent (0).
      expect(await count(c.h, 'issues', 'priority = 4')).toBe(2);
      expect(await count(c.h, 'issues', 'priority = 0')).toBe(0);
      const g = await q<{ is_group: boolean; parent: string | null; name: string }>(c.h, `select is_group, parent_label_id as parent, name from labels where lower(name) in ('area','area/x') order by name`);
      expect(g.find((x) => x.name === 'area/x')!.parent).not.toBeNull();
    } finally {
      await c.h.close();
    }
  });
});
