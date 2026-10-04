/**
 * Client-side ordering and grouping for issue lists (SPEC §4.10.2, §3.10).
 *
 * The server returns rows ordered by group, then by the display ordering. The client
 * re-applies the same comparator to its loaded prefix so optimistic edits (status,
 * priority, assignee…) move rows immediately; the next server refresh is then a no-op.
 * Labels are grouped client-side (an issue appears under each of its labels).
 */

export type GroupBy = 'status' | 'assignee' | 'priority' | 'label' | 'project' | 'cycle' | 'team' | 'none';
export type Ordering = 'priority' | 'status' | 'created' | 'updated' | 'estimate' | 'manual';
export type StatusCategory = 'backlog' | 'todo' | 'in_progress' | 'done' | 'canceled';

export interface OrderTerm {
  field: 'priority' | 'status' | 'createdAt' | 'updatedAt' | 'completedAt' | 'estimate' | 'manual' | 'title' | 'identifier';
  direction: 'asc' | 'desc';
}

export interface GroupableIssue {
  id: string;
  identifier: string;
  title: string;
  number: number;
  priority: number;
  estimate: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  teamId: string;
  statusId: string;
  assigneeId: string | null;
  projectId: string | null;
  cycleId: string | null;
  labelIds: readonly string[];
  cycle?: { startsAt: string } | null;
}

export interface CatalogStatus {
  id: string;
  name: string;
  category: StatusCategory;
  order: number;
  teamId: string;
  color: string;
}

export interface GroupingCatalog {
  teams: ReadonlyMap<string, { id: string; key: string; name: string; sortOrder: number }>;
  statuses: ReadonlyMap<string, CatalogStatus>;
  users: ReadonlyMap<string, { id: string; name: string }>;
  projects: ReadonlyMap<string, { id: string; name: string }>;
  labels: ReadonlyMap<string, { id: string; name: string }>;
  cycles?: ReadonlyMap<string, { id: string; startsAt: string; name: string }>;
}

export const CATEGORY_RANK: Record<StatusCategory, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  done: 3,
  canceled: 4,
};

/** Display ordering → order terms (mirrors services/issues/filter-sql.ts displayOrdering). */
export function orderTermsFor(ordering: Ordering | null | undefined): OrderTerm[] {
  switch (ordering) {
    case 'status':
      return [
        { field: 'status', direction: 'asc' },
        { field: 'priority', direction: 'asc' },
      ];
    case 'created':
      return [{ field: 'createdAt', direction: 'desc' }];
    case 'updated':
      return [{ field: 'updatedAt', direction: 'desc' }];
    case 'estimate':
      return [{ field: 'estimate', direction: 'desc' }];
    case 'manual':
      return [{ field: 'manual', direction: 'asc' }];
    case 'priority':
    default:
      return [
        { field: 'priority', direction: 'asc' },
        { field: 'updatedAt', direction: 'desc' },
      ];
  }
}

// Plain (non-numeric) text order, like the server's `order by name` / `lower(title)`.
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

function cmp(a: number | string, b: number | string): number {
  if (typeof a === 'string' && typeof b === 'string') return collator.compare(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Bytewise order for uuid tie-breakers (Postgres compares uuids by bytes). */
function cmpRaw(a: string | null | undefined, b: string | null | undefined): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
}

/** Groupings whose last sort-key element is an entity id (uuid tie-breaker). */
const ID_TIEBREAK: ReadonlySet<GroupBy> = new Set<GroupBy>(['status', 'assignee', 'project', 'cycle', 'label']);

/** Nulls sort last regardless of direction (Postgres `nulls last`). */
function cmpNullable(a: number | string | null | undefined, b: number | string | null | undefined, dir: 1 | -1): number {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return cmp(a, b) * dir;
}

/** Rank of a group key for the group ordering the server applies. */
export function groupSortKey(groupBy: GroupBy, key: string | null, catalog: GroupingCatalog): (number | string | null)[] {
  switch (groupBy) {
    case 'status': {
      const s = key ? catalog.statuses.get(key) : undefined;
      const team = s ? catalog.teams.get(s.teamId) : undefined;
      return [team?.sortOrder ?? Number.MAX_SAFE_INTEGER, s ? CATEGORY_RANK[s.category] : 9, s?.order ?? 0, key];
    }
    case 'assignee':
      return [key ? (catalog.users.get(key)?.name ?? '') : null, key];
    case 'priority':
      return [key === null ? 99 : Number(key)];
    case 'project':
      return [key ? (catalog.projects.get(key)?.name ?? '') : null, key];
    case 'cycle': {
      const startsAt = key ? catalog.cycles?.get(key)?.startsAt : undefined;
      // starts_at desc nulls last → invert timestamps.
      return [startsAt ? -Date.parse(startsAt) : null, key];
    }
    case 'team': {
      const t = key ? catalog.teams.get(key) : undefined;
      return [t?.sortOrder ?? Number.MAX_SAFE_INTEGER, t?.key ?? ''];
    }
    case 'label':
      return [key ? (catalog.labels.get(key)?.name ?? '') : null, key];
    case 'none':
    default:
      return [];
  }
}

export function compareGroupKeys(groupBy: GroupBy, a: string | null, b: string | null, catalog: GroupingCatalog): number {
  const ka = groupSortKey(groupBy, a, catalog);
  const kb = groupSortKey(groupBy, b, catalog);
  const last = Math.max(ka.length, kb.length) - 1;
  for (let i = 0; i <= last; i++) {
    if (i === last && ID_TIEBREAK.has(groupBy)) return cmpRaw(ka[i] as string | null, kb[i] as string | null);
    const r = cmpNullable(ka[i], kb[i], 1);
    if (r !== 0) return r;
  }
  return 0;
}

/** Primary group key of an issue (labels use the first label; see groupIssues for fan-out). */
export function groupKeyOf(issue: GroupableIssue, groupBy: GroupBy): string | null {
  switch (groupBy) {
    case 'status':
      return issue.statusId;
    case 'assignee':
      return issue.assigneeId;
    case 'priority':
      return String(issue.priority);
    case 'project':
      return issue.projectId;
    case 'cycle':
      return issue.cycleId;
    case 'team':
      return issue.teamId;
    case 'label':
      return issue.labelIds[0] ?? null;
    case 'none':
    default:
      return null;
  }
}

function compareByTerm(a: GroupableIssue, b: GroupableIssue, term: OrderTerm, catalog: GroupingCatalog): number {
  const dir = term.direction === 'desc' ? -1 : 1;
  switch (term.field) {
    case 'priority':
      return cmp(a.priority, b.priority) * dir;
    case 'status': {
      const sa = catalog.statuses.get(a.statusId);
      const sb = catalog.statuses.get(b.statusId);
      const r = cmp(sa ? CATEGORY_RANK[sa.category] : 9, sb ? CATEGORY_RANK[sb.category] : 9) * dir;
      return r !== 0 ? r : cmp(sa?.order ?? 0, sb?.order ?? 0) * dir;
    }
    case 'createdAt':
      return cmp(a.createdAt, b.createdAt) * dir;
    case 'updatedAt':
      return cmp(a.updatedAt, b.updatedAt) * dir;
    case 'completedAt':
      return cmpNullable(a.completedAt, b.completedAt, dir);
    case 'estimate':
      return cmpNullable(a.estimate, b.estimate, dir);
    case 'manual':
      return cmp(a.sortOrder, b.sortOrder) * dir;
    case 'title':
      return cmp(a.title.toLowerCase(), b.title.toLowerCase()) * dir;
    case 'identifier': {
      const ta = catalog.teams.get(a.teamId)?.key ?? '';
      const tb = catalog.teams.get(b.teamId)?.key ?? '';
      const r = cmp(ta, tb) * dir;
      return r !== 0 ? r : cmp(a.number, b.number) * dir;
    }
    default:
      return 0;
  }
}

export function makeIssueComparator(
  groupBy: GroupBy,
  order: readonly OrderTerm[],
  catalog: GroupingCatalog,
): (a: GroupableIssue, b: GroupableIssue) => number {
  return (a, b) => {
    if (groupBy !== 'label' && groupBy !== 'none') {
      const g = compareGroupKeys(groupBy, groupKeyOf(a, groupBy), groupKeyOf(b, groupBy), catalog);
      if (g !== 0) return g;
    }
    for (const term of order) {
      const r = compareByTerm(a, b, term, catalog);
      if (r !== 0) return r;
    }
    // Server tie-breakers: created_at desc, id asc.
    const c = cmp(b.createdAt, a.createdAt);
    if (c !== 0) return c;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

export interface IssueGroup<T extends GroupableIssue> {
  key: string | null;
  /** Total in the group per the server (falls back to the loaded count). */
  count: number;
  issues: T[];
  /** Rows the server has but the client has not loaded yet. */
  unloaded: number;
}

export interface GroupOptions {
  /** Server counts per group key (issueGroupCounts). */
  counts?: ReadonlyMap<string | null, number>;
  /** All candidate keys (e.g. every status of the team) to show empty groups. */
  allKeys?: readonly (string | null)[];
  showEmptyGroups?: boolean;
  /** Everything is loaded (no more pages): unloaded is zero for every group. */
  complete?: boolean;
}

/**
 * Split a sorted list into groups. With server counts the result also says how many rows
 * of each group are still unloaded, so the virtual list can reserve their height.
 * Because the server orders by group, only the group at the load frontier is partial.
 */
export function groupIssues<T extends GroupableIssue>(
  sorted: readonly T[],
  groupBy: GroupBy,
  catalog: GroupingCatalog,
  opts: GroupOptions = {},
): IssueGroup<T>[] {
  const byKey = new Map<string | null, T[]>();
  if (groupBy === 'label') {
    for (const issue of sorted) {
      const keys = issue.labelIds.length > 0 ? issue.labelIds : [null];
      for (const k of keys) {
        const list = byKey.get(k) ?? [];
        list.push(issue);
        byKey.set(k, list);
      }
    }
  } else if (groupBy === 'none') {
    byKey.set(null, [...sorted]);
  } else {
    for (const issue of sorted) {
      const k = groupKeyOf(issue, groupBy);
      const list = byKey.get(k) ?? [];
      list.push(issue);
      byKey.set(k, list);
    }
  }

  const keys = new Set<string | null>(byKey.keys());
  if (opts.counts) for (const [k, n] of opts.counts) if (n > 0) keys.add(k);
  if (opts.showEmptyGroups && opts.allKeys) for (const k of opts.allKeys) keys.add(k);
  if (groupBy === 'none') {
    keys.clear();
    keys.add(null);
  }

  const ordered = [...keys].sort((a, b) => compareGroupKeys(groupBy, a, b, catalog));
  // Labels fan out, so their counts cannot be mapped onto the flat server order.
  const reserve = !opts.complete && groupBy !== 'label';
  return ordered.map((key) => {
    const issues = byKey.get(key) ?? [];
    const serverCount = opts.counts?.get(key);
    const count = Math.max(serverCount ?? issues.length, issues.length);
    return { key, issues, count, unloaded: reserve ? count - issues.length : 0 };
  });
}

export type ListRow<T> =
  | { type: 'header'; key: string | null; count: number; collapsed: boolean }
  | { type: 'issue'; issue: T; groupKey: string | null }
  | { type: 'placeholder'; groupKey: string | null; globalIndex: number };

/**
 * Flatten groups into virtual rows. Placeholders carry the global (server) index they
 * stand for, so the list can request exactly the page that covers them.
 */
export function flattenGroups<T extends GroupableIssue>(
  groups: readonly IssueGroup<T>[],
  collapsed: ReadonlySet<string>,
  opts: { headers: boolean },
): ListRow<T>[] {
  const rows: ListRow<T>[] = [];
  let globalIndex = 0;
  for (const g of groups) {
    const isCollapsed = collapsed.has(groupToken(g.key));
    if (opts.headers) rows.push({ type: 'header', key: g.key, count: g.count, collapsed: isCollapsed });
    if (!isCollapsed) {
      for (const issue of g.issues) rows.push({ type: 'issue', issue, groupKey: g.key });
      for (let i = 0; i < g.unloaded; i++) {
        rows.push({ type: 'placeholder', groupKey: g.key, globalIndex: globalIndex + g.issues.length + i });
      }
    }
    globalIndex += g.issues.length + g.unloaded;
  }
  return rows;
}

/** Stable string for a group key (null → "∅"), used for collapse state. */
export function groupToken(key: string | null): string {
  return key ?? '∅';
}
