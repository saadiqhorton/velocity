/**
 * Demo / performance seed (SPEC §8.1 M2 exit: "10k-issue seed passes perf budgets").
 *   DATABASE_URL=… APP_SECRET=… pnpm --filter @velocity/server seed -- --issues 10000
 *   --deterministic [--seed-date YYYY-MM-DD] fixes issue content and timestamps for E2E.
 * Creates a demo owner (if the workspace is empty), three teams, labels, projects with
 * milestones, closed + active cycles, and N issues with realistic distributions.
 * Bulk-inserts through SQL for speed; numbering counters stay consistent.
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import pino from 'pino';
import { v7 as uuidv7 } from 'uuid';
import { runMigrations } from '@velocity/schema/migrate';
import { migrationsFolder } from './migrations-folder';
import { LocalDiskDriver, MemoryJobQueue, createDb, createServices, memberActor } from '@velocity/services';
import type { ServiceActor } from '@velocity/services';
import { loadConfig } from './config';

const { values } = parseArgs({
  // pnpm forwards the optional separator to the script verbatim.
  args: process.argv.slice(2).filter((arg, index) => index !== 0 || arg !== '--'),
  options: {
    issues: { type: 'string', default: '600' },
    username: { type: 'string', default: 'demo' },
    password: { type: 'string', default: 'correct-horse-battery-staple' },
    deterministic: { type: 'boolean', default: false },
    'seed-date': { type: 'string' },
  },
});
const total = Number(values.issues);
if (!Number.isSafeInteger(total) || total < 0) throw new Error('--issues must be a non-negative integer.');
// A day-level clock keeps the seeded current cycle current during E2E while making
// two fresh runs on the same day byte-for-byte stable in their visible data.
const seedDate = values['seed-date'] ?? new Date().toISOString().slice(0, 10);
if (values.deterministic && !/^\d{4}-\d{2}-\d{2}$/.test(seedDate)) throw new Error('--seed-date must be YYYY-MM-DD.');
const seedNow = values.deterministic ? Date.parse(`${seedDate}T12:00:00.000Z`) : Date.now();
if (!Number.isFinite(seedNow)) throw new Error('Invalid --seed-date.');
let rngState = 0x5eed2026;
const random = values.deterministic
  ? () => {
      rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
      return rngState / 0x1_0000_0000;
    }
  : Math.random;
const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
await runMigrations(pool, migrationsFolder());
const services = createServices({
  db: createDb(pool),
  pool,
  config: config.app,
  jobs: new MemoryJobQueue(),
  storage: new LocalDiskDriver(config.app.uploadDir),
  logger: pino({ level: 'warn' }),
});

const rand = (n: number) => Math.floor(random() * n);
const pick = <T>(xs: readonly T[]): T => xs[rand(xs.length)]!;

let owner: ServiceActor;
const status = await services.auth.setupStatus();
if (status.needsSetup) {
  const s = await services.auth.setupWorkspace({ workspaceName: 'Demo', username: values.username!, password: values.password!, name: 'Demo Owner' }, {});
  owner = memberActor(s.user);
  console.log(`created demo owner ${values.username}`);
} else {
  const r = await pool.query<{ id: string }>('select id from users where is_owner limit 1');
  const u = await services.users.get(r.rows[0]!.id);
  owner = memberActor(u!);
}
await services.labels.ensureDefaults();
const members: string[] = [owner.userId];
for (const name of ['alex', 'sam', 'jordan']) {
  if (!(await services.users.byUsername(name))) {
    const inv = await services.auth.createInvite(owner, { name });
    const s = await services.auth.acceptInvite({ token: inv.token, username: name, password: 'correct-horse-battery-staple', name: name[0]!.toUpperCase() + name.slice(1) }, {});
    members.push(s.user.id);
  } else members.push((await services.users.byUsername(name))!.id);
}

const teamSpecs = [
  { key: 'ENG', name: 'Engineering', cycleEnabled: true },
  { key: 'WEB', name: 'Web', cycleEnabled: false },
  { key: 'OPS', name: 'Operations', cycleEnabled: false },
];
const teams = [];
for (const spec of teamSpecs) {
  const existing = await services.teams.getByKey(spec.key);
  if (existing) {
    // The first-run wizard creates ENG with cycles off; the seed's cycle scenario needs them on.
    teams.push(existing.cycleEnabled === spec.cycleEnabled ? existing : await services.teams.update(owner, existing.id, { cycleEnabled: spec.cycleEnabled }));
  } else {
    teams.push(await services.teams.create(owner, { ...spec, color: pick(['blue', 'green', 'purple'] as const) }));
  }
}
const labels = (await services.labels.list()).filter((l) => !l.isGroup);
const projects = [];
for (const name of ['Public launch', 'Billing v2', 'Mobile polish']) {
  const existing = (await services.projects.list(owner)).find((p) => p.name === name);
  const p = existing ?? (await services.projects.create(owner, { name, status: pick(['planned', 'in_progress'] as const), health: pick(['on_track', 'at_risk'] as const), teamIds: [teams[0]!.id], targetDate: new Date(seedNow + rand(90) * 86_400_000).toISOString().slice(0, 10) }));
  projects.push(p);
  if (!existing) for (const m of ['Alpha', 'Beta', 'GA']) await services.projects.createMilestone(owner, p.id, { name: m });
}

// Cycles: six closed (with stats) + current + upcoming for ENG.
const eng = teams[0]!;
const existingCycles = await services.cycles.list(eng.id);
if (existingCycles.length === 0) {
  const week = 7 * 86_400_000;
  const start = seedNow - 6 * 2 * week - rand(week);
  for (let n = 1; n <= 6; n++) {
    const s = new Date(start + (n - 1) * 2 * week);
    const e = new Date(s.getTime() + 2 * week);
    const scope = 18 + rand(12);
    const done = Math.round(scope * (0.6 + random() * 0.35));
    await pool.query(
      `insert into cycles (id, team_id, number, starts_at, ends_at, closed_at, stats) values ($1,$2,$3,$4,$5,$5,$6)`,
      [uuidv7(), eng.id, n, s, e, { scopeCount: Math.round(scope / 2), scopePoints: scope, completedCount: Math.round(done / 2), completedPoints: done, canceledCount: rand(2), addedAfterStartCount: rand(4), removedCount: rand(2), carriedOverCount: rand(4) }],
    );
  }
}
await services.cycles.rotateTeam(eng.id);
const openCycles = (await services.cycles.list(eng.id)).filter((c) => !c.closedAt);
// The list is newest-first, so the active (current) cycle is the last open one, not openCycles[0]
// (which is the upcoming window). Scope seeded issues onto the current cycle (SPEC §3.8).
const activeCycleId = openCycles.length ? openCycles[openCycles.length - 1]!.id : null;

const words = ['login', 'cache', 'billing', 'webhook', 'search', 'sidebar', 'export', 'import', 'latency', 'onboarding', 'invite', 'theme', 'keyboard', 'palette', 'cycle', 'board', 'filter', 'notification', 'avatar', 'upload'];
const verbs = ['Fix', 'Add', 'Improve', 'Refactor', 'Investigate', 'Remove', 'Document', 'Speed up', 'Polish', 'Support'];
const t0 = Date.now();
let created = 0;
for (const team of teams) {
  const share = team === eng ? Math.ceil(total * 0.5) : Math.ceil(total * 0.25);
  const sts = await services.teams.statuses(team.id);
  const weights = { backlog: 0.3, todo: 0.2, in_progress: 0.12, done: 0.33, canceled: 0.05 } as const;
  for (let off = 0; off < share && created < total; off += 1000) {
    const n = Math.min(1000, share - off, total - created);
    const counter = await pool.query<{ next: number }>('update team_counters set next_number = next_number + $2 where team_id = $1 returning next_number - $2 as next', [team.id, n]);
    const first = counter.rows[0]!.next;
    const rows: unknown[][] = [];
    for (let i = 0; i < n; i++) {
      const r = random();
      let acc = 0;
      let cat: keyof typeof weights = 'backlog';
      for (const [k, w] of Object.entries(weights) as [keyof typeof weights, number][]) {
        acc += w;
        if (r <= acc) {
          cat = k;
          break;
        }
      }
      const st = sts.find((s) => s.category === cat)!;
      const createdAt = new Date(seedNow - rand(120) * 86_400_000 - rand(86_400_000));
      const completedAt = cat === 'done' ? new Date(Math.min(seedNow, createdAt.getTime() + rand(30) * 86_400_000)) : null;
      rows.push([
        uuidv7(), team.id, first + i, `${pick(verbs)} ${pick(words)} ${pick(words)}`, '', st.id, random() < 0.6 ? pick(members) : null,
        rand(5), random() < 0.7 ? pick([1, 2, 3, 5, 8]) : null, (first + i) * 1000,
        random() < 0.3 ? pick(projects).id : null,
        team === eng && activeCycleId && random() < 0.3 ? activeCycleId : null,
        owner.userId, createdAt, completedAt ?? createdAt, completedAt, cat === 'canceled' ? createdAt : null,
      ]);
    }
    const cols = 17;
    const params = rows.flat();
    const tuples = rows.map((_, ri) => `(${Array.from({ length: cols }, (_, ci) => `$${ri * cols + ci + 1}`).join(',')})`).join(',');
    const inserted = await pool.query<{ id: string }>(
      `insert into issues (id, team_id, number, title, description_md, status_id, assignee_id, priority, estimate, sort_order, project_id, cycle_id, created_by, created_at, updated_at, completed_at, canceled_at)
       values ${tuples} returning id`,
      params,
    );
    const labelRows = inserted.rows.filter(() => random() < 0.5).map((r) => [r.id, pick(labels).id]);
    if (labelRows.length) {
      await pool.query(
        `insert into issue_labels (issue_id, label_id) values ${labelRows.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',')} on conflict do nothing`,
        labelRows.flat(),
      );
    }
    created += n;
    process.stdout.write(`\rseeded ${created}/${total} issues`);
  }
}
await pool.query(`insert into cycle_history (id, cycle_id, issue_id, added_at) select gen_random_uuid(), cycle_id, id, created_at from issues where cycle_id is not null on conflict do nothing`);
for (const p of projects) {
  await pool.query(`update projects p set progress_total = s.t, progress_done = s.d from (select count(*) filter (where st.category <> 'canceled')::int t, count(*) filter (where st.category = 'done')::int d from issues i join statuses st on st.id = i.status_id where i.project_id = $1) s where p.id = $1`, [p.id]);
}
await pool.query('analyze');
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await pool.end();
