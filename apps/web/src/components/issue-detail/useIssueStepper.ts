import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '@/app/workspace';
import type { TeamFieldsFragment } from '@/gql/graphql';
import { useIssueList } from '@/components/issues/useIssueList';
import { navStateFor, readNavState, updateListFocus } from '@/lib/issueNav';
import type { IssueNavState, ListNavParams } from '@/lib/issueNav';
import { ACTIVE_WITHOUT_CYCLES, DEFAULT_DISPLAY, composeFilter } from '@/lib/viewState';
import { teamUsesCycles, useFeatures } from '@/lib/features';
import type { Features } from '@/lib/features';

/** The team Active list, for issues opened directly (deep link, palette, search). */
export function teamListParams(team: TeamFieldsFragment, features: Features): ListNavParams {
  const cycleId = teamUsesCycles(features, team) ? team.activeCycle?.id : undefined;
  return {
    scope: cycleId ? { teamId: team.id, cycleId } : { teamId: team.id },
    filter: composeFilter('', cycleId ? [] : [ACTIVE_WITHOUT_CYCLES]),
    display: DEFAULT_DISPLAY,
    allGroupKeys: team.statuses.map((s) => s.id),
    collapsed: [],
  };
}

const NO_PARAMS: ListNavParams = { scope: {}, filter: '', display: DEFAULT_DISPLAY, collapsed: [] };

export interface IssueStepper {
  /** 1-based position, or null when the issue is not in the list. */
  position: number | null;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  prev: () => void;
  next: () => void;
  /** Where Esc, Backspace and the breadcrumb go. */
  back: () => void;
  backTo: string;
  backLabel: string;
}

/**
 * `n / total` and J/K on the issue page (U1): the order of the list the page was opened
 * from (rebuilt from the same query, usually straight from the cache), or the team's
 * Active list when the page was opened directly.
 */
export function useIssueStepper(issue: { id: string; teamId: string }): IssueStepper {
  const ws = useWorkspace();
  const features = useFeatures();
  const location = useLocation();
  const navigate = useNavigate();
  const nav = readNavState(location.state);
  const team = ws.teamsById.get(issue.teamId);

  const fallback = useMemo(() => (team ? teamListParams(team, features) : null), [team, features]);
  const params = nav?.source.params ?? fallback ?? NO_PARAMS;
  const collapsed = useMemo(() => new Set(params.collapsed), [params.collapsed]);
  const data = useIssueList({
    scope: params.scope,
    filter: params.filter,
    display: params.display,
    allGroupKeys: params.allGroupKeys,
    collapsed,
    eagerLimit: params.eagerLimit,
    skip: !nav && !fallback,
  });

  const order = useMemo(
    () =>
      params.display.layout === 'board'
        ? data.groups.flatMap((g) => g.issues)
        : data.rows.flatMap((r) => (r.type === 'issue' ? [r.issue] : [])),
    [params.display.layout, data.groups, data.rows],
  );
  const index = order.findIndex((i) => i.id === issue.id);

  // Not loaded yet (deep in a long list): keep paging until found or the list ends.
  // Fetch a full page at a time so opening issue 1,500 does not require 30 requests.
  const { hasMore, loadedCount, ensureLoaded } = data;
  useEffect(() => {
    if (index === -1 && hasMore) ensureLoaded(loadedCount + 999);
  }, [index, hasMore, loadedCount, ensureLoaded]);
  useEffect(() => {
    if (index >= 0 && hasMore && index >= loadedCount - 3) ensureLoaded(loadedCount);
  }, [index, hasMore, loadedCount, ensureLoaded]);

  const source = nav?.source;
  const backTo = source?.returnTo ?? (team ? `/team/${team.key}/active` : '/');
  const backLabel = source?.label ?? team?.name ?? '';

  const go = (delta: 1 | -1) => {
    const target = order[index + delta];
    if (index < 0 || !target) return;
    if (source) updateListFocus(source.listId, target.id);
    // Stepping replaces the entry, so Back (and Esc) still lands on the list.
    const state: IssueNavState | null = nav ? { ...nav } : null;
    navigate(`/issue/${target.identifier}`, { replace: true, state: navStateFor(state) });
  };

  return {
    position: index >= 0 ? index + 1 : null,
    total: Math.max(data.total, order.length),
    canPrev: index > 0,
    canNext: index >= 0 && index < order.length - 1,
    prev: () => go(-1),
    next: () => go(1),
    back: () => {
      // Straight from the list (only replaced entries since): pop back to it, keeping history clean.
      if (nav && nav.depth === 0 && (window.history.state as { idx?: number } | null)?.idx) navigate(-1);
      else navigate(backTo);
    },
    backTo,
    backLabel,
  };
}
