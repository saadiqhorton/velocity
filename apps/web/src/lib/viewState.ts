/**
 * View state ↔ URL (SPEC §3.10): every view state is a query string; chips are canonical
 * in the UI and the filter DSL is the interchange format (§6.1.4). Only values that differ
 * from the screen's defaults are written, so default URLs stay clean.
 */
import { fromChips, parseFilter, serializeFilter, toChips } from '@velocity/graphql/dsl';
import type { FilterChip } from '@velocity/graphql/dsl';
import type { FilterOrder, FilterQuery } from '@velocity/schema/filter-ast';
import type { GroupBy, Ordering } from './grouping';

export type Layout = 'list' | 'board';
export type ShowCompleted = 'all' | 'week' | 'none';

export const COLUMN_KEYS = [
  'priority',
  'identifier',
  'status',
  'labels',
  'project',
  'cycle',
  'estimate',
  'assignee',
  'created',
  'updated',
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

export const DEFAULT_COLUMNS: ColumnKey[] = ['priority', 'identifier', 'status', 'labels', 'project', 'assignee'];

export interface DisplayState {
  grouping: GroupBy;
  ordering: Ordering;
  layout: Layout;
  columns: ColumnKey[];
  showEmptyGroups: boolean;
  showSubIssues: boolean;
  showCompleted: ShowCompleted;
}

export interface ViewState {
  /** Canonical DSL (may include an `order:` clause). */
  filter: string;
  display: DisplayState;
}

export const DEFAULT_DISPLAY: DisplayState = {
  grouping: 'status',
  ordering: 'priority',
  layout: 'list',
  columns: DEFAULT_COLUMNS,
  showEmptyGroups: false,
  showSubIssues: true,
  showCompleted: 'all',
};

const GROUPINGS: readonly GroupBy[] = ['status', 'assignee', 'priority', 'label', 'project', 'cycle', 'team', 'none'];
const ORDERINGS: readonly Ordering[] = ['priority', 'status', 'created', 'updated', 'estimate', 'manual'];

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: string | null, fallback: boolean): boolean {
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

/** URL params → view state, falling back to `defaults` for anything absent or invalid. */
export function parseViewState(params: URLSearchParams, defaults: ViewState): ViewState {
  const d = defaults.display;
  const cols = params.get('cols');
  const columns =
    cols === null
      ? d.columns
      : (cols.split(',').filter((c): c is ColumnKey => (COLUMN_KEYS as readonly string[]).includes(c)) as ColumnKey[]);
  return {
    filter: params.get('filter') ?? defaults.filter,
    display: {
      grouping: oneOf(params.get('group'), GROUPINGS, d.grouping),
      ordering: oneOf(params.get('order'), ORDERINGS, d.ordering),
      layout: oneOf<Layout>(params.get('layout'), ['list', 'board'], d.layout),
      columns,
      showEmptyGroups: bool(params.get('empty'), d.showEmptyGroups),
      showSubIssues: bool(params.get('sub'), d.showSubIssues),
      showCompleted: oneOf<ShowCompleted>(params.get('done'), ['all', 'week', 'none'], d.showCompleted),
    },
  };
}

/**
 * View state → URL params (only the diff from defaults). Unrelated params already in
 * `base` (e.g. `issue` for the detail panel) are preserved.
 */
export function writeViewState(state: ViewState, defaults: ViewState, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  const d = defaults.display;
  const s = state.display;
  const put = (key: string, value: string | null) => {
    if (value === null) p.delete(key);
    else p.set(key, value);
  };
  // A cleared filter on a screen with a non-empty default is written as `filter=` so it survives reloads and shared links.
  put('filter', state.filter.trim() !== defaults.filter.trim() ? state.filter.trim() : null);
  put('group', s.grouping !== d.grouping ? s.grouping : null);
  put('order', s.ordering !== d.ordering ? s.ordering : null);
  put('layout', s.layout !== d.layout ? s.layout : null);
  put('cols', s.columns.join(',') !== d.columns.join(',') ? s.columns.join(',') : null);
  put('empty', s.showEmptyGroups !== d.showEmptyGroups ? (s.showEmptyGroups ? '1' : '0') : null);
  put('sub', s.showSubIssues !== d.showSubIssues ? (s.showSubIssues ? '1' : '0') : null);
  put('done', s.showCompleted !== d.showCompleted ? s.showCompleted : null);
  return p;
}

export interface ParsedFilter {
  /** null when the DSL uses OR / nested groups that chips cannot represent. */
  chips: FilterChip[] | null;
  order: FilterOrder[];
  error: string | null;
}

export function chipsFromDsl(dsl: string): ParsedFilter {
  if (!dsl.trim()) return { chips: [], order: [], error: null };
  try {
    const q: FilterQuery = parseFilter(dsl);
    return { chips: toChips(q.filter), order: q.order, error: null };
  } catch (err) {
    return { chips: null, order: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export function dslFromChips(chips: readonly FilterChip[], order: readonly FilterOrder[] = []): string {
  return serializeFilter({ filter: fromChips([...chips]), order: [...order] });
}

/** Canonicalize a DSL string; returns the input unchanged when it does not parse. */
export function canonicalDsl(dsl: string): string {
  try {
    return serializeFilter(parseFilter(dsl));
  } catch {
    return dsl.trim();
  }
}

/**
 * Combine the user's filter with screen constraints (completed-issue display, Active
 * screen scope) into one DSL string for the API. The `order:` clause stays last.
 */
export function composeFilter(user: string, extra: readonly string[]): string {
  let q: FilterQuery;
  try {
    q = parseFilter(user);
  } catch {
    // Invalid user DSL: send it as-is so the server returns the typed error with a caret.
    return user;
  }
  const filterPart = q.filter ? serializeFilter({ filter: q.filter, order: [] }) : '';
  const orderPart = q.order.length ? serializeFilter({ filter: null, order: q.order }) : '';
  const parts = [filterPart, ...extra].filter((s) => s.trim() !== '').map((s) => `(${s})`);
  return [parts.join(' and '), orderPart].filter(Boolean).join(' ');
}

/** DSL clause for the "completed issues" display option. */
export function completedClause(show: ShowCompleted): string | null {
  switch (show) {
    case 'none':
      return 'statusCategory nin:done,canceled';
    case 'week':
      return 'statusCategory nin:done,canceled or completedAt gte:-1w';
    default:
      return null;
  }
}
