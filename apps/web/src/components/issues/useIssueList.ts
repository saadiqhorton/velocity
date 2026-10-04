import { useCallback, useEffect, useMemo, useRef } from 'react';
import { NetworkStatus, useQuery } from '@apollo/client';
import { IssueGroupCountsDocument, IssueListDocument } from '@/gql/graphql';
import type { GroupBy as GqlGroupBy, IssueListQueryVariables, IssueRowFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { flattenGroups, groupIssues, makeIssueComparator, orderTermsFor } from '@/lib/grouping';
import type { GroupBy, IssueGroup, ListRow, OrderTerm } from '@/lib/grouping';
import { chipsFromDsl } from '@/lib/viewState';
import type { DisplayState } from '@/lib/viewState';
import { PAGE_SIZE } from '@/lib/realtime';
import { runInBackground } from '@/lib/errors';

export type IssueRow = IssueRowFieldsFragment;

export interface IssueListScope {
  teamId?: string;
  projectId?: string;
  cycleId?: string;
  milestoneId?: string;
  parentId?: string;
  subscribed?: boolean;
  onlyTrashed?: boolean;
  includeArchived?: boolean;
}

export interface IssueListParams {
  scope: IssueListScope;
  /** Composed DSL (user filter + screen constraints). */
  filter: string;
  display: DisplayState;
  /** Group keys to show even when empty (with display.showEmptyGroups). */
  allGroupKeys?: (string | null)[];
  /** Collapsed group tokens. */
  collapsed?: ReadonlySet<string>;
  /** Load everything up to this many rows eagerly (boards). */
  eagerLimit?: number;
  skip?: boolean;
}

export interface IssueListResult {
  issues: IssueRow[];
  groups: IssueGroup<IssueRow>[];
  rows: ListRow<IssueRow>[];
  total: number;
  loading: boolean;
  /** First load without any data yet (render skeletons). */
  initialLoading: boolean;
  error: Error | undefined;
  hasMore: boolean;
  loadingMore: boolean;
  loadedCount: number;
  /** Make sure rows up to `globalIndex` (server offset) are loaded. */
  ensureLoaded: (globalIndex: number) => void;
  refresh: () => void;
  orderTerms: OrderTerm[];
}

const MAX_PAGE = 1000;

/**
 * Issue list data (SPEC §4.10.2, §4.16): one offset-paginated query ordered by group, plus
 * per-group counts for headers. The loaded prefix is re-sorted client-side with the
 * server's comparator so optimistic edits move rows instantly.
 */
export function useIssueList(params: IssueListParams): IssueListResult {
  const { catalog } = useWorkspace();
  const { scope, filter, display } = params;
  const grouping: GroupBy = display.grouping;
  const serverGroup: GqlGroupBy = grouping === 'label' ? 'none' : grouping;

  const baseVars = useMemo(
    () => ({
      filter: filter || null,
      teamId: scope.teamId ?? null,
      projectId: scope.projectId ?? null,
      cycleId: scope.cycleId ?? null,
      milestoneId: scope.milestoneId ?? null,
      parentId: scope.parentId ?? null,
      subscribed: scope.subscribed ?? null,
      onlyTrashed: scope.onlyTrashed ?? null,
      includeArchived: scope.includeArchived ?? null,
      includeSubIssues: display.showSubIssues,
    }),
    [filter, scope.teamId, scope.projectId, scope.cycleId, scope.milestoneId, scope.parentId, scope.subscribed, scope.onlyTrashed, scope.includeArchived, display.showSubIssues],
  );

  const listVars: IssueListQueryVariables = useMemo(
    () => ({ ...baseVars, groupBy: serverGroup, ordering: display.ordering, first: Math.max(PAGE_SIZE, Math.min(params.eagerLimit ?? 0, MAX_PAGE)) }),
    [baseVars, serverGroup, display.ordering, params.eagerLimit],
  );

  const list = useQuery(IssueListDocument, {
    variables: listVars,
    skip: params.skip,
    notifyOnNetworkStatusChange: true,
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-first',
  });
  const counts = useQuery(IssueGroupCountsDocument, {
    variables: { ...baseVars, groupBy: grouping },
    skip: params.skip,
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-first',
  });

  const nodes = list.data?.issues.nodes;
  const pageInfo = list.data?.issues.pageInfo;
  const loadedCount = nodes?.length ?? 0;
  const hasMore = pageInfo?.hasNextPage ?? false;

  const orderTerms = useMemo<OrderTerm[]>(() => {
    const parsed = chipsFromDsl(filter);
    return parsed.order.length > 0 ? (parsed.order as OrderTerm[]) : orderTermsFor(display.ordering);
  }, [filter, display.ordering]);

  const issues = useMemo(() => {
    if (!nodes) return [];
    // Optimistic archive/trash hides rows at once (the server agrees after refresh).
    const visible = nodes.filter((n) => (scope.includeArchived || !n.archivedAt) && (scope.onlyTrashed ? Boolean(n.trashedAt) : !n.trashedAt));
    return [...visible].sort(makeIssueComparator(grouping, orderTerms, catalog));
  }, [nodes, grouping, orderTerms, catalog, scope.includeArchived, scope.onlyTrashed]);

  const countMap = useMemo(() => {
    const map = new Map<string | null, number>();
    for (const c of counts.data?.issueGroupCounts ?? []) map.set(c.key, c.count);
    return map;
  }, [counts.data]);

  const total = useMemo(() => {
    if (!counts.data) return issues.length;
    if (grouping === 'label') return Math.max(issues.length, loadedCount);
    let sum = 0;
    for (const n of countMap.values()) sum += n;
    return sum;
  }, [counts.data, countMap, grouping, issues.length, loadedCount]);

  const groups = useMemo(
    () =>
      groupIssues(issues, grouping, catalog, {
        counts: counts.data ? countMap : undefined,
        allKeys: params.allGroupKeys,
        showEmptyGroups: display.showEmptyGroups,
        complete: !hasMore,
      }),
    [issues, grouping, catalog, counts.data, countMap, params.allGroupKeys, display.showEmptyGroups, hasMore],
  );

  const collapsed = params.collapsed;
  const rows = useMemo(
    () => flattenGroups(groups, collapsed ?? new Set(), { headers: grouping !== 'none' }),
    [groups, collapsed, grouping],
  );

  const fetchingRef = useRef(false);
  const { fetchMore } = list;
  const loadingMore = list.networkStatus === NetworkStatus.fetchMore;

  const ensureLoaded = useCallback(
    (globalIndex: number) => {
      if (fetchingRef.current || !hasMore || !pageInfo?.endCursor) return;
      if (globalIndex < loadedCount) return;
      fetchingRef.current = true;
      const first = Math.min(MAX_PAGE, Math.max(PAGE_SIZE, globalIndex - loadedCount + PAGE_SIZE));
      runInBackground(
        fetchMore({ variables: { after: pageInfo.endCursor, first } }).finally(() => {
          fetchingRef.current = false;
        }),
      );
    },
    [hasMore, pageInfo?.endCursor, loadedCount, fetchMore],
  );

  // Boards and small lists load eagerly up to a cap.
  useEffect(() => {
    if (params.eagerLimit && hasMore && loadedCount < params.eagerLimit) ensureLoaded(loadedCount);
  }, [params.eagerLimit, hasMore, loadedCount, ensureLoaded]);

  const { refetch } = list;
  const refetchCounts = counts.refetch;
  const refresh = useCallback(() => {
    runInBackground(refetch({ ...listVars, first: Math.min(MAX_PAGE, Math.max(PAGE_SIZE, loadedCount)), after: null }));
    runInBackground(refetchCounts());
  }, [refetch, refetchCounts, listVars, loadedCount]);

  return {
    issues,
    groups,
    rows,
    total,
    loading: list.loading,
    initialLoading: !list.data && list.loading,
    error: list.error,
    hasMore,
    loadingMore,
    loadedCount,
    ensureLoaded,
    refresh,
    orderTerms,
  };
}
