import { describe, expect, it } from 'vitest';
import {
  flattenGroups,
  groupIssues,
  groupToken,
  makeIssueComparator,
  orderTermsFor,
} from './grouping';
import type {
  CatalogStatus,
  GroupableIssue,
  GroupBy,
  GroupingCatalog,
  OrderTerm,
  Ordering,
  StatusCategory,
} from './grouping';

// ───────────── seeded PRNG ─────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const int = (r: Rng, n: number): number => Math.floor(r() * n);
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, xs.length)] as T;
const hex = (r: Rng, n: number): string => Array.from({ length: n }, () => '0123456789abcdef'[int(r, 16)]).join('');
const uuid = (r: Rng): string => `${hex(r, 8)}-${hex(r, 4)}-${hex(r, 4)}-${hex(r, 4)}-${hex(r, 12)}`;
/** Collation-neutral ids (no digits): isolates ordering logic from the numeric-collation difference. */
const letterId = (r: Rng): string => Array.from({ length: 12 }, () => 'abcdefghijklmnop'[int(r, 16)]).join('');
type IdGen = (r: Rng) => string;

// ───────────── fixtures ─────────────

const CATEGORIES: StatusCategory[] = ['backlog', 'todo', 'in_progress', 'done', 'canceled'];

interface World {
  catalog: GroupingCatalog;
  statusIds: string[];
  userIds: string[];
  projectIds: string[];
  cycleIds: string[];
  teamIds: string[];
}

function makeWorld(r: Rng, uuid: IdGen = letterId): World {
  const teams = new Map<string, { id: string; key: string; name: string; sortOrder: number }>();
  const t1 = uuid(r);
  const t2 = uuid(r);
  // Team sortOrder deliberately differs from id order.
  teams.set(t1, { id: t1, key: 'ZED', name: 'Zed', sortOrder: 0 });
  teams.set(t2, { id: t2, key: 'ABC', name: 'Abc', sortOrder: 1 });
  const statuses = new Map<string, CatalogStatus>();
  for (const teamId of [t1, t2]) {
    let order = 0;
    for (const category of CATEGORIES) {
      // Two statuses per category in some teams; order values may repeat across categories.
      const n = 1 + int(r, 2);
      for (let i = 0; i < n; i++) {
        const id = uuid(r);
        statuses.set(id, { id, name: `${category}-${i}`, category, order: category === 'todo' ? 0 : order++, teamId, color: 'gray' });
      }
    }
  }
  // Names are lowercase ASCII so DB collation vs. JS collation cannot differ; some duplicates force
  // the tie to fall through to the id.
  const nameBank = ['alice', 'bob', 'carol', 'dave', 'bob', 'erin'];
  const users = new Map<string, { id: string; name: string }>();
  for (const name of nameBank) {
    const id = uuid(r);
    users.set(id, { id, name });
  }
  const projects = new Map<string, { id: string; name: string }>();
  for (const name of ['apollo', 'zeus', 'hera', 'apollo']) {
    const id = uuid(r);
    projects.set(id, { id, name });
  }
  const cycles = new Map<string, { id: string; startsAt: string; name: string }>();
  const starts = ['2026-01-05T00:00:00.000Z', '2026-01-19T00:00:00.000Z', '2026-02-02T00:00:00.000Z', '2026-01-19T00:00:00.000Z'];
  starts.forEach((startsAt, i) => {
    const id = uuid(r);
    cycles.set(id, { id, startsAt, name: `Cycle ${i}` });
  });
  return {
    catalog: { teams, statuses, users, projects, labels: new Map(), cycles },
    statusIds: [...statuses.keys()],
    userIds: [...users.keys()],
    projectIds: [...projects.keys()],
    cycleIds: [...cycles.keys()],
    teamIds: [t1, t2],
  };
}

const TIMES = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i, 9, 30, 0, 0)).toISOString());

function makeIssues(r: Rng, w: World, n: number, uuid: IdGen = letterId): GroupableIssue[] {
  return Array.from({ length: n }, (_, i) => {
    const statusId = pick(r, w.statusIds);
    const status = w.catalog.statuses.get(statusId) as CatalogStatus;
    const done = status.category === 'done';
    return {
      id: uuid(r),
      identifier: `X-${i}`,
      title: `issue ${letterId(r)}`,
      number: i,
      priority: int(r, 5),
      estimate: r() < 0.4 ? null : int(r, 6),
      sortOrder: r() < 0.3 ? int(r, 5) : r() * 1000,
      // Small pool of timestamps forces many ties.
      createdAt: r() < 0.5 ? pick(r, TIMES) : new Date(Date.UTC(2026, 0, 1, 0, 0, int(r, 100000))).toISOString(),
      updatedAt: r() < 0.5 ? pick(r, TIMES) : new Date(Date.UTC(2026, 0, 2, 0, 0, int(r, 100000))).toISOString(),
      completedAt: done && r() < 0.8 ? pick(r, TIMES) : null,
      teamId: status.teamId,
      statusId,
      assigneeId: r() < 0.3 ? null : pick(r, w.userIds),
      projectId: r() < 0.3 ? null : pick(r, w.projectIds),
      cycleId: r() < 0.3 ? null : pick(r, w.cycleIds),
      labelIds: [],
    };
  });
}

// ───────────── independent reference (from the SQL in services/issues) ─────────────
//
//   ORDER BY [groupOrder(groupBy)], [orderSql(order)], issues.created_at desc, issues.id
//
// Postgres: ASC => NULLS LAST, DESC => NULLS FIRST unless `nulls last` is written.

type V = number | string | null;
interface SortKey {
  v: V;
  dir: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

/** Byte-wise comparison, like a C-collated text column or a uuid column. */
function pgCompare(a: V, b: V, dir: 'asc' | 'desc', nulls?: 'first' | 'last'): number {
  const nullsFirst = nulls ? nulls === 'first' : dir === 'desc';
  if (a === null && b === null) return 0;
  if (a === null) return nullsFirst ? -1 : 1;
  if (b === null) return nullsFirst ? 1 : -1;
  const c = a < b ? -1 : a > b ? 1 : 0;
  return dir === 'desc' ? -c : c;
}

function refKeys(issue: GroupableIssue, groupBy: GroupBy, terms: readonly OrderTerm[], w: World): SortKey[] {
  const c = w.catalog;
  const status = c.statuses.get(issue.statusId) as CatalogStatus;
  const team = c.teams.get(issue.teamId) as { key: string; sortOrder: number };
  const rank = CATEGORIES.indexOf(status.category); // case statuses.category when backlog 0 ... else 4
  const keys: SortKey[] = [];
  const asc = (v: V, nulls?: 'first' | 'last'): void => void keys.push({ v, dir: 'asc', nulls });
  switch (groupBy) {
    case 'status':
      asc(team.sortOrder);
      asc(rank);
      asc(status.order);
      asc(status.id);
      break;
    case 'assignee':
      asc(issue.assigneeId ? (c.users.get(issue.assigneeId)?.name ?? null) : null); // name asc nulls last
      asc(issue.assigneeId);
      break;
    case 'priority':
      asc(issue.priority);
      break;
    case 'project':
      asc(issue.projectId ? (c.projects.get(issue.projectId)?.name ?? null) : null);
      asc(issue.projectId);
      break;
    case 'cycle': {
      const startsAt = issue.cycleId ? (c.cycles?.get(issue.cycleId)?.startsAt ?? null) : null;
      keys.push({ v: startsAt, dir: 'desc', nulls: 'last' }); // starts_at desc nulls last
      asc(issue.cycleId);
      break;
    }
    case 'team':
      asc(team.sortOrder);
      asc(team.key);
      break;
    default:
      break;
  }
  for (const t of terms) {
    const dir = t.direction;
    switch (t.field) {
      case 'priority':
        keys.push({ v: issue.priority, dir });
        break;
      case 'status':
        keys.push({ v: rank, dir }, { v: status.order, dir });
        break;
      case 'createdAt':
        keys.push({ v: issue.createdAt, dir });
        break;
      case 'updatedAt':
        keys.push({ v: issue.updatedAt, dir });
        break;
      case 'completedAt':
        keys.push({ v: issue.completedAt, dir, nulls: 'last' });
        break;
      case 'estimate':
        keys.push({ v: issue.estimate, dir, nulls: 'last' });
        break;
      case 'manual':
        keys.push({ v: issue.sortOrder, dir });
        break;
      case 'title':
        keys.push({ v: issue.title.toLowerCase(), dir });
        break;
      case 'identifier':
        keys.push({ v: team.key, dir }, { v: issue.number, dir });
        break;
    }
  }
  keys.push({ v: issue.createdAt, dir: 'desc' }, { v: issue.id, dir: 'asc' });
  return keys;
}

function refSort(issues: readonly GroupableIssue[], groupBy: GroupBy, terms: readonly OrderTerm[], w: World): string[] {
  const keyed = issues.map((i) => ({ id: i.id, keys: refKeys(i, groupBy, terms, w) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < a.keys.length; i++) {
      const ka = a.keys[i] as SortKey;
      const kb = b.keys[i] as SortKey;
      const r = pgCompare(ka.v, kb.v, ka.dir, ka.nulls);
      if (r !== 0) return r;
    }
    return 0;
  });
  return keyed.map((k) => k.id);
}

/** Expected `displayOrdering` table, copied from packages/services/src/issues/filter-sql.ts. */
const SERVER_DISPLAY_ORDERING: Record<Ordering, OrderTerm[]> = {
  priority: [
    { field: 'priority', direction: 'asc' },
    { field: 'updatedAt', direction: 'desc' },
  ],
  status: [
    { field: 'status', direction: 'asc' },
    { field: 'priority', direction: 'asc' },
  ],
  created: [{ field: 'createdAt', direction: 'desc' }],
  updated: [{ field: 'updatedAt', direction: 'desc' }],
  estimate: [{ field: 'estimate', direction: 'desc' }],
  manual: [{ field: 'manual', direction: 'asc' }],
};

const GROUPS: GroupBy[] = ['status', 'assignee', 'priority', 'project', 'cycle', 'team', 'none'];
const ORDERINGS: Ordering[] = ['priority', 'status', 'created', 'updated', 'estimate', 'manual'];

describe('orderTermsFor', () => {
  for (const o of ORDERINGS) {
    it(`${o} equals the server displayOrdering`, () => {
      expect(orderTermsFor(o)).toEqual(SERVER_DISPLAY_ORDERING[o]);
    });
  }
  it('null/undefined/unknown fall back to priority like the server', () => {
    expect(orderTermsFor(null)).toEqual(SERVER_DISPLAY_ORDERING.priority);
    expect(orderTermsFor(undefined)).toEqual(SERVER_DISPLAY_ORDERING.priority);
    expect(orderTermsFor('bogus' as Ordering)).toEqual(SERVER_DISPLAY_ORDERING.priority);
  });
});

describe('client comparator matches the server ordering (property)', () => {
  const seeds = [1, 2, 3, 4, 5];
  for (const seed of seeds) {
    const r = mulberry32(seed);
    const w = makeWorld(r);
    const issues = makeIssues(r, w, 200);
    for (const groupBy of GROUPS) {
      for (const ordering of ORDERINGS) {
        it(`seed ${seed} groupBy=${groupBy} ordering=${ordering}`, () => {
          const terms = orderTermsFor(ordering);
          const cmp = makeIssueComparator(groupBy, terms, w.catalog);
          const client = [...issues].sort(cmp).map((i) => i.id);
          expect(client).toEqual(refSort(issues, groupBy, terms, w));
        });
      }
    }
  }

  describe('uuid ids (groupings without id tie-breaks between groups)', () => {
    const r = mulberry32(42);
    const w = makeWorld(r, uuid);
    const issues = makeIssues(r, w, 200, uuid);
    for (const groupBy of ['none', 'priority', 'team'] as GroupBy[]) {
      for (const ordering of ORDERINGS) {
        it(`groupBy=${groupBy} ordering=${ordering}`, () => {
          const terms = orderTermsFor(ordering);
          const client = [...issues].sort(makeIssueComparator(groupBy, terms, w.catalog)).map((i) => i.id);
          expect(client).toEqual(refSort(issues, groupBy, terms, w));
        });
      }
    }
  });

  describe('explicit DSL order terms', () => {
    const r = mulberry32(99);
    const w = makeWorld(r);
    const issues = makeIssues(r, w, 200);
    const termSets: [string, OrderTerm[]][] = [
      ['completedAt asc', [{ field: 'completedAt', direction: 'asc' }]],
      ['completedAt desc', [{ field: 'completedAt', direction: 'desc' }]],
      ['estimate asc', [{ field: 'estimate', direction: 'asc' }]],
      ['estimate desc, priority desc', [{ field: 'estimate', direction: 'desc' }, { field: 'priority', direction: 'desc' }]],
      ['title asc', [{ field: 'title', direction: 'asc' }]],
      ['identifier desc', [{ field: 'identifier', direction: 'desc' }]],
      ['status desc', [{ field: 'status', direction: 'desc' }]],
      ['manual desc', [{ field: 'manual', direction: 'desc' }]],
    ];
    for (const [name, terms] of termSets) {
      for (const groupBy of ['none', 'status', 'team'] as GroupBy[]) {
        it(`${name} groupBy=${groupBy}`, () => {
          const client = [...issues].sort(makeIssueComparator(groupBy, terms, w.catalog)).map((i) => i.id);
          expect(client).toEqual(refSort(issues, groupBy, terms, w));
        });
      }
    }
  });

  it('is a consistent total order (antisymmetric, transitive on a sample)', () => {
    const r = mulberry32(7);
    const w = makeWorld(r);
    const issues = makeIssues(r, w, 60);
    const cmp = makeIssueComparator('status', orderTermsFor('priority'), w.catalog);
    for (const a of issues) {
      expect(cmp(a, a)).toBe(0);
      for (const b of issues) expect(Math.sign(cmp(a, b)) + 0).toBe(-Math.sign(cmp(b, a)) + 0);
    }
  });
});

/** Status/team ids that exist in a generated world, so the reference comparator can resolve them. */
function inWorld(w: World): Pick<GroupableIssue, 'statusId' | 'teamId'> {
  const status = [...w.catalog.statuses.values()][0] as CatalogStatus;
  return { statusId: status.id, teamId: status.teamId };
}

describe('collation parity with the server', () => {
  // Fixed: src/lib/grouping.ts used Intl.Collator({ numeric: true }) for everything.
  // group-key tie-breakers (status id, assignee_id, project_id, cycle_id) are compared with a
  // numeric, case-insensitive collator, but Postgres orders uuid columns bytewise. Two users with the
  // same name and ids "10000000-..." / "9fffffff-..." sort 10.. < 9f.. in SQL and 9f.. < 10.. in the client.
  it('orders equal-name assignee groups by uuid bytes like Postgres', () => {
    const w = makeWorld(mulberry32(1));
    const u1 = '10000000-0000-0000-0000-000000000000';
    const u2 = '9fffffff-0000-0000-0000-000000000000';
    w.catalog = {
      ...w.catalog,
      users: new Map([
        [u1, { id: u1, name: 'bob' }],
        [u2, { id: u2, name: 'bob' }],
      ]),
    };
    const issues = [simple('a', { ...inWorld(w), assigneeId: u2 }), simple('b', { ...inWorld(w), assigneeId: u1 })];
    const client = [...issues].sort(makeIssueComparator('assignee', orderTermsFor('priority'), w.catalog)).map((i) => i.id);
    expect(client).toEqual(refSort(issues, 'assignee', orderTermsFor('priority'), w));
  });

  // Fixed: compareByTerm 'title' used the numeric collator; server sorts
  // lower(issues.title) without natural-number ordering, so "issue 10" < "issue 9" in SQL.
  it('title order uses plain text order like lower(title)', () => {
    const w = makeWorld(mulberry32(1));
    const issues = [simple('a', { ...inWorld(w), title: 'Issue 9' }), simple('b', { ...inWorld(w), title: 'Issue 10' })];
    const terms: OrderTerm[] = [{ field: 'title', direction: 'asc' }];
    const client = [...issues].sort(makeIssueComparator('none', terms, w.catalog)).map((i) => i.id);
    expect(client).toEqual(refSort(issues, 'none', terms, w));
  });
});

// ───────────── groupIssues / flattenGroups ─────────────

function simple(id: string, over: Partial<GroupableIssue> = {}): GroupableIssue {
  return {
    id,
    identifier: id,
    title: id,
    number: 1,
    priority: 2,
    estimate: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    teamId: 't1',
    statusId: 's1',
    assigneeId: null,
    projectId: null,
    cycleId: null,
    labelIds: [],
    ...over,
  };
}

const smallCatalog: GroupingCatalog = {
  teams: new Map([['t1', { id: 't1', key: 'ENG', name: 'Eng', sortOrder: 0 }]]),
  statuses: new Map([
    ['s1', { id: 's1', name: 'Todo', category: 'todo', order: 0, teamId: 't1', color: 'gray' }],
    ['s2', { id: 's2', name: 'Doing', category: 'in_progress', order: 1, teamId: 't1', color: 'blue' }],
    ['s3', { id: 's3', name: 'Done', category: 'done', order: 2, teamId: 't1', color: 'green' }],
  ]),
  users: new Map([
    ['u1', { id: 'u1', name: 'alice' }],
    ['u2', { id: 'u2', name: 'bob' }],
  ]),
  projects: new Map(),
  labels: new Map([
    ['l1', { id: 'l1', name: 'bug' }],
    ['l2', { id: 'l2', name: 'ui' }],
  ]),
  cycles: new Map(),
};

describe('groupIssues', () => {
  const sorted = [
    simple('a', { statusId: 's1' }),
    simple('b', { statusId: 's1' }),
    simple('c', { statusId: 's2' }),
  ];

  it('groups by key in catalog order and counts the loaded rows', () => {
    const g = groupIssues(sorted, 'status', smallCatalog);
    expect(g.map((x) => [x.key, x.count, x.unloaded, x.issues.map((i) => i.id)])).toEqual([
      ['s1', 2, 0, ['a', 'b']],
      ['s2', 1, 0, ['c']],
    ]);
  });
  it('uses server counts and reserves unloaded rows', () => {
    const counts = new Map<string | null, number>([['s1', 5], ['s2', 3], ['s3', 2]]);
    const g = groupIssues(sorted, 'status', smallCatalog, { counts });
    expect(g.map((x) => [x.key, x.count, x.unloaded])).toEqual([
      ['s1', 5, 3],
      ['s2', 3, 2],
      ['s3', 2, 2],
    ]);
  });
  it('count never drops below the loaded rows', () => {
    const g = groupIssues(sorted, 'status', smallCatalog, { counts: new Map([['s1', 1]]) });
    expect(g[0]).toMatchObject({ key: 's1', count: 2, unloaded: 0 });
  });
  it('ignores zero server counts and adds groups the server knows about', () => {
    const g = groupIssues(sorted, 'status', smallCatalog, { counts: new Map([['s3', 0], ['s2', 1]]) });
    expect(g.map((x) => x.key)).toEqual(['s1', 's2']);
    const g2 = groupIssues([], 'status', smallCatalog, { counts: new Map([['s3', 4]]) });
    expect(g2).toEqual([{ key: 's3', issues: [], count: 4, unloaded: 4 }]);
  });
  it('complete disables reservations', () => {
    const g = groupIssues(sorted, 'status', smallCatalog, { counts: new Map([['s1', 5]]), complete: true });
    expect(g[0]).toMatchObject({ count: 5, unloaded: 0 });
  });
  it('showEmptyGroups with allKeys shows empty groups in order', () => {
    const g = groupIssues(sorted, 'status', smallCatalog, { showEmptyGroups: true, allKeys: ['s3', 's2', 's1'] });
    expect(g.map((x) => [x.key, x.count])).toEqual([['s1', 2], ['s2', 1], ['s3', 0]]);
    const hidden = groupIssues(sorted, 'status', smallCatalog, { allKeys: ['s3', 's2', 's1'] });
    expect(hidden.map((x) => x.key)).toEqual(['s1', 's2']);
  });
  it('null keys sort last for assignee', () => {
    const issues = [simple('a', { assigneeId: null }), simple('b', { assigneeId: 'u2' }), simple('c', { assigneeId: 'u1' })];
    const g = groupIssues(issues, 'assignee', smallCatalog);
    expect(g.map((x) => x.key)).toEqual(['u1', 'u2', null]);
  });
  it('priority groups are numeric strings in ascending order', () => {
    const issues = [simple('a', { priority: 3 }), simple('b', { priority: 0 }), simple('c', { priority: 1 })];
    expect(groupIssues(issues, 'priority', smallCatalog).map((x) => x.key)).toEqual(['0', '1', '3']);
  });
  it('label fan-out puts an issue under each label; unlabeled go under null', () => {
    const issues = [
      simple('a', { labelIds: ['l1', 'l2'] }),
      simple('b', { labelIds: ['l2'] }),
      simple('c', { labelIds: [] }),
    ];
    const g = groupIssues(issues, 'label', smallCatalog, { counts: new Map([['l1', 9]]) });
    expect(g.map((x) => [x.key, x.issues.map((i) => i.id)])).toEqual([
      ['l1', ['a']],
      ['l2', ['a', 'b']],
      [null, ['c']],
    ]);
    // Labels never reserve: counts cannot map onto the flat order.
    expect(g.every((x) => x.unloaded === 0)).toBe(true);
    expect(g[0]?.count).toBe(9);
  });
  it('none yields a single group', () => {
    const g = groupIssues(sorted, 'none', smallCatalog, { counts: new Map([[null, 10]]) });
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ key: null, count: 10, unloaded: 7 });
    expect(groupIssues([], 'none', smallCatalog)).toEqual([{ key: null, issues: [], count: 0, unloaded: 0 }]);
  });
  it('does not mutate the sorted input', () => {
    const copy = [...sorted];
    groupIssues(sorted, 'none', smallCatalog);
    expect(sorted).toEqual(copy);
  });
});

describe('flattenGroups', () => {
  const issues = [simple('a', { statusId: 's1' }), simple('b', { statusId: 's1' }), simple('c', { statusId: 's2' })];
  const groups = groupIssues(issues, 'status', smallCatalog, { counts: new Map([['s1', 4], ['s2', 3]]) });

  it('emits headers, issues and placeholders with global indexes', () => {
    const rows = flattenGroups(groups, new Set(), { headers: true });
    expect(rows.map((r) => (r.type === 'header' ? `H:${r.key}:${r.count}:${r.collapsed}` : r.type === 'issue' ? `I:${r.issue.id}` : `P:${r.groupKey}:${r.globalIndex}`))).toEqual([
      'H:s1:4:false',
      'I:a',
      'I:b',
      'P:s1:2',
      'P:s1:3',
      'H:s2:3:false',
      'I:c',
      'P:s2:5',
      'P:s2:6',
    ]);
  });
  it('omits headers when asked', () => {
    const rows = flattenGroups(groups, new Set(), { headers: false });
    expect(rows.some((r) => r.type === 'header')).toBe(false);
    expect(rows).toHaveLength(7);
  });
  it('collapsed groups hide rows but keep globalIndex advancing', () => {
    const rows = flattenGroups(groups, new Set([groupToken('s1')]), { headers: true });
    expect(rows[0]).toEqual({ type: 'header', key: 's1', count: 4, collapsed: true });
    expect(rows[1]).toMatchObject({ type: 'header', key: 's2' });
    const placeholders = rows.filter((r) => r.type === 'placeholder');
    expect(placeholders.map((p) => (p.type === 'placeholder' ? p.globalIndex : -1))).toEqual([5, 6]);
    expect(rows.filter((r) => r.type === 'issue')).toHaveLength(1);
  });
  it('collapsing the null group uses the null token', () => {
    const g = groupIssues([simple('a', { assigneeId: null })], 'assignee', smallCatalog);
    const rows = flattenGroups(g, new Set([groupToken(null)]), { headers: true });
    expect(rows).toEqual([{ type: 'header', key: null, count: 1, collapsed: true }]);
  });
  it('handles no groups', () => {
    expect(flattenGroups([], new Set(), { headers: true })).toEqual([]);
  });
});

describe('groupToken', () => {
  it('is stable and distinguishes null', () => {
    expect(groupToken(null)).toBe('∅');
    expect(groupToken('abc')).toBe('abc');
    expect(groupToken(null)).not.toBe(groupToken(''));
  });
});
