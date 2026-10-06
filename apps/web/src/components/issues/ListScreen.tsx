import { useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Button, EmptyState, InlineMessage } from '@velocity/ui';
import type { FilterField } from '@velocity/schema/filter-ast';
import { useWorkspace } from '@/app/workspace';
import { useCommands } from '@/keyboard/react';
import { useCollapsedGroups, useListPrefs } from '@/stores/listPrefs';
import type { CreateDefaults } from '@/stores/ui';
import type { GroupBy } from '@/lib/grouping';
import { chipsFromDsl, completedClause, composeFilter, dslFromChips, parseViewState, writeViewState } from '@/lib/viewState';
import type { DisplayState, ViewState } from '@/lib/viewState';
import { describeError, filterErrorCaret } from '@/lib/errors';
import { listReturnPath, useListSources } from '@/lib/issueNav';
import { ViewHeader } from '@/components/shell/ViewHeader';
import { FilterBar } from '@/components/filters/FilterBar';
import { DisplayOptions } from '@/components/filters/DisplayOptions';
import { IssueList } from './IssueList';
import { IssueBoard } from './IssueBoard';
import { useIssueList } from './useIssueList';
import type { IssueListScope } from './useIssueList';
import { useFeatures } from '@/lib/features';
import { m } from '@/i18n';

export interface ListScreenProps {
  listId: string;
  title: ReactNode;
  /** Plain-text name for the issue page breadcrumb when `title` is not a string. */
  navLabel?: string;
  icon?: ReactNode;
  scope: IssueListScope;
  defaults: ViewState;
  /** Screen constraints applied on top of the user's filter (never shown as chips). */
  extraFilters?: (string | null | undefined)[];
  context?: CreateDefaults;
  /** Controls after the title (cycle picker, progress, presets). */
  headerExtra?: ReactNode;
  /** Actions before Display options. */
  actions?: ReactNode;
  /** Content between the header and the list (e.g. cycle summary). */
  subheader?: ReactNode;
  empty?: ReactNode;
  reorderable?: boolean;
  hiddenFilterFields?: FilterField[];
  hiddenGroupings?: GroupBy[];
  cycleNames?: ReadonlyMap<string, string>;
  /** Issue ids added to the scoped cycle after it started (per-row scope marker). */
  addedAfterStartIds?: ReadonlySet<string>;
  /** Hide the "+ New issue" button. */
  noCreate?: boolean;
  /** Embedded lists (project tab) skip the 48px header. */
  embedded?: boolean;
  /** Called with the current state (saved views compare against it). */
  onStateChange?: (state: ViewState) => void;
}

/**
 * A list/board screen with URL-serialized view state (SPEC §3.10): filter chips ↔ DSL in
 * `?filter=`, display options in short params, defaults omitted from the URL.
 */
export function ListScreen(props: ListScreenProps) {
  const { listId, scope, defaults } = props;
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseViewState(params, defaults), [params, defaults]);
  const parsed = useMemo(() => chipsFromDsl(state.filter), [state.filter]);
  const collapsed = useCollapsedGroups(listId);
  const toggleGroup = useListPrefs((s) => s.toggleGroup);

  const setState = useCallback(
    (next: ViewState) => {
      setParams((prev) => writeViewState(next, defaults, prev), { replace: true });
      props.onStateChange?.(next);
    },
    [setParams, defaults, props],
  );

  const board = state.display.layout === 'board';
  const features = useFeatures();
  // Boards need columns: fall back to status when the list is ungrouped. A saved cycle grouping
  // or estimate order falls back too while that feature is off (Solo mode, U4).
  const grouping: GroupBy =
    (board && state.display.grouping === 'none') || (!features.cycles && state.display.grouping === 'cycle') ? 'status' : state.display.grouping;
  const ordering = !features.estimates && state.display.ordering === 'estimate' ? 'priority' : state.display.ordering;
  const display: DisplayState = useMemo(() => ({ ...state.display, grouping, ordering }), [state.display, grouping, ordering]);

  const filter = useMemo(
    () => composeFilter(state.filter, [...(props.extraFilters ?? []), completedClause(display.showCompleted)].filter((x): x is string => Boolean(x))),
    [state.filter, props.extraFilters, display.showCompleted],
  );

  const allGroupKeys = useMemo(() => {
    if (grouping === 'status') {
      const teams = scope.teamId ? ws.teams.filter((t) => t.id === scope.teamId) : ws.teams;
      return teams.flatMap((t) => t.statuses.map((s) => s.id));
    }
    if (grouping === 'priority') return ['0', '1', '2', '3', '4'];
    return undefined;
  }, [grouping, scope.teamId, ws.teams]);

  const eagerLimit = board ? 500 : undefined;
  const data = useIssueList({
    scope,
    filter,
    display,
    allGroupKeys,
    collapsed,
    eagerLimit,
  });

  // Let the issue page rebuild this list's order (n / total, J/K) from the same query (U1).
  const location = useLocation();
  const register = useListSources((s) => s.register);
  const unregister = useListSources((s) => s.unregister);
  const navLabel = props.navLabel ?? (typeof props.title === 'string' ? props.title : m.list.issues);
  const returnTo = listReturnPath(location.pathname, location.search);
  useEffect(() => {
    register({ listId, label: navLabel, returnTo, params: { scope, filter, display, allGroupKeys, collapsed: [...collapsed], eagerLimit } });
  }, [register, listId, navLabel, returnTo, scope, filter, display, allGroupKeys, collapsed, eagerLimit]);
  useEffect(() => () => unregister(listId), [unregister, listId]);

  useCommands(() => [
    {
      id: 'view.toggleLayout',
      title: m.cmd.toggleLayout,
      group: 'list',
      keys: ['b'],
      run: () => setState({ ...state, display: { ...state.display, layout: board ? 'list' : 'board' } }),
    },
  ]);

  const hasUserFilter = state.filter.trim() !== '' && state.filter.trim() !== defaults.filter.trim();
  const clearFilters = () => setState({ ...state, filter: defaults.filter });
  const empty = hasUserFilter ? (
    <EmptyState icon="filter" message={m.list.emptyFiltered} action={<Button onClick={clearFilters}>{m.list.clearFilters}</Button>} />
  ) : (
    (props.empty ?? <EmptyState icon="list" message={m.list.emptyTeam} />)
  );

  const dirty = writeViewState(state, defaults).toString() !== '';
  const error = data.error && !data.issues.length ? describeError(data.error) : null;
  const caret = data.error ? filterErrorCaret(data.error) : null;

  const content = error ? (
    <div className="p-5">
      <InlineMessage appearance="error" title={error.message} action={<Button size="sm" onClick={clearFilters}>{m.list.clearFilters}</Button>}>
        {caret ? <pre className="mt-1 overflow-x-auto font-mono text-sm">{caret}</pre> : null}
      </InlineMessage>
    </div>
  ) : board ? (
    <IssueBoard listId={listId} data={data} grouping={grouping} context={props.context} cycleNames={props.cycleNames} empty={empty} />
  ) : (
    <IssueList
      listId={listId}
      data={data}
      display={display}
      onToggleGroup={(token) => toggleGroup(listId, token)}
      context={props.context}
      empty={empty}
      reorderable={props.reorderable && display.ordering === 'manual'}
      cycleNames={props.cycleNames}
      addedAfterStartIds={props.addedAfterStartIds}
    />
  );

  const controls = (
    <>
      {props.headerExtra}
      <FilterBar
        chips={parsed.chips}
        onChange={(chips) => setState({ ...state, filter: dslFromChips(chips, parsed.order) })}
        teamId={scope.teamId}
        hiddenFields={props.hiddenFilterFields}
      />
    </>
  );
  const actions = (
    <>
      {props.actions}
      <DisplayOptions
        display={state.display}
        onChange={(d) => setState({ ...state, display: d })}
        hiddenGroupings={props.hiddenGroupings}
        dirty={dirty}
        onReset={() => setState(defaults)}
      />
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`list-screen-${listId}`}>
      {props.embedded ? (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-5">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">{controls}</div>
          {actions}
        </div>
      ) : (
        <ViewHeader title={props.title} icon={props.icon} count={data.initialLoading ? null : data.total} create={props.noCreate ? false : (props.context ?? {})} actions={actions}>
          {controls}
        </ViewHeader>
      )}
      {props.subheader}
      {content}
    </div>
  );
}
