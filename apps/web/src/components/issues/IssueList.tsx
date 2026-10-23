import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent, ReactNode } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { Range } from '@tanstack/react-virtual';
import clsx from 'clsx';
import type { IssueRowFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useCommands } from '@/keyboard/react';
import { useActiveList } from '@/stores/list';
import { useSelection } from '@/stores/selection';
import { useUi } from '@/stores/ui';
import type { CreateDefaults } from '@/stores/ui';
import { canDragIssues, groupToken } from '@/lib/grouping';
import type { GroupBy, ListRow } from '@/lib/grouping';
import type { DisplayState } from '@/lib/viewState';
import { useClosePanel, useOpenIssue, usePanelIssueId } from '@/lib/navigation';
import { forgetListMemory, listReturnPath, peekListMemory } from '@/lib/issueNav';
import { useLocation } from 'react-router-dom';
import { spaceTargetOk, openRowContextMenu } from './rowActions';
import { setIssueDragPreview } from '@/lib/dragPreview';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';
import { IssueRow, PlaceholderRow } from './IssueRow';
import { GroupHeader, groupInfo } from './GroupHeader';
import { useIssueDrop } from './useIssueDrop';
import type { IssueListResult } from './useIssueList';
import { m } from '@/i18n';

export const ROW_HEIGHT = 36;

export interface IssueListProps {
  listId: string;
  data: IssueListResult;
  display: DisplayState;
  onToggleGroup: (token: string) => void;
  /** Create-issue defaults for this list (team, project, cycle). */
  context?: CreateDefaults;
  empty: ReactNode;
  /** Manual ordering: enables ⌥↑/↓ and dropping a row into a position within its group. */
  reorderable?: boolean;
  /** Group names for cycles (cycle grouping) when not in the workspace catalog. */
  cycleNames?: ReadonlyMap<string, string>;
  /** Issue ids added to the scoped cycle after it started (cycle screens). */
  addedAfterStartIds?: ReadonlySet<string>;
  className?: string;
}

function lastHeaderAtOrBefore(headerIndexes: readonly number[], index: number): number | null {
  let found: number | null = null;
  for (const h of headerIndexes) {
    if (h <= index) found = h;
    else break;
  }
  return found;
}

/** The group a row drops into (placeholders are not drop targets). */
function dropGroupOf(row: ListRow<IssueRowFieldsFragment>): string | null | undefined {
  if (row.type === 'placeholder') return undefined;
  return row.type === 'issue' ? row.groupKey : row.key;
}

export function IssueList({ listId, data, display, onToggleGroup, context, empty, reorderable, cycleNames, addedAfterStartIds, className }: IssueListProps) {
  const ws = useWorkspace();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { rows, issues } = data;
  const grouping: GroupBy = display.grouping;

  const focusedId = useActiveList((s) => (s.listId === listId ? s.focusedId : null));
  const setList = useActiveList((s) => s.setList);
  const clearList = useActiveList((s) => s.clearList);
  const setFocused = useActiveList((s) => s.setFocused);
  const selected = useSelection((s) => s.selected);
  const toggle = useSelection((s) => s.toggle);
  const range = useSelection((s) => s.range);
  const setSelection = useSelection((s) => s.set);
  const openCreate = useUi((s) => s.openCreate);
  const openIssue = useOpenIssue();
  const closePanel = useClosePanel();
  const panelIssueId = usePanelIssueId();
  const domFocusPending = useRef(false);
  const location = useLocation();
  // Scroll + focus to restore when coming back from the issue page (U1), read once.
  const restore = useRef<ReturnType<typeof peekListMemory> | undefined>(undefined);
  if (restore.current === undefined) restore.current = peekListMemory(listId, listReturnPath(location.pathname, location.search));

  const order = useMemo(() => rows.flatMap((r) => (r.type === 'issue' ? [r.issue.id] : [])), [rows]);
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r, i) => {
      if (r.type === 'issue' && !map.has(r.issue.id)) map.set(r.issue.id, i);
    });
    return map;
  }, [rows]);
  const headerIndexes = useMemo(() => rows.flatMap((r, i) => (r.type === 'header' ? [i] : [])), [rows]);

  // Publish this list as the active one (J/K, S/A/L target, ⇧X ranges).
  useEffect(() => {
    setList(listId, order, { teamId: context?.teamId, projectId: context?.projectId ?? undefined, cycleId: context?.cycleId ?? undefined });
  }, [listId, order, setList, context?.teamId, context?.projectId, context?.cycleId]);
  useEffect(() => () => clearList(listId), [clearList, listId]);

  const idWidth = useMemo(() => Math.max(6, ...issues.slice(0, 500).map((i) => i.identifier.length)) + 0.5, [issues]);

  const rangeExtractor = useCallback(
    (r: Range) => {
      const sticky = lastHeaderAtOrBefore(headerIndexes, r.startIndex);
      const next = new Set(defaultRangeExtractor(r));
      if (sticky !== null) next.add(sticky);
      return [...next].sort((a, b) => a - b);
    },
    [headerIndexes],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is used as documented.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
    // Back from the issue page: start where the list was (U1).
    initialOffset: () => restore.current?.scrollTop ?? 0,
    rangeExtractor,
    getItemKey: (index) => {
      const r = rows[index];
      if (!r) return index;
      // Issues key by id so a row keeps its element when it moves to another group and glides there.
      // Label grouping repeats an issue under each of its labels, so those keys also carry the group.
      if (r.type === 'issue') return grouping === 'label' ? `i:${r.groupKey ?? ''}:${r.issue.id}` : `i:${r.issue.id}`;
      if (r.type === 'header') return `h:${groupToken(r.key)}`;
      return `p:${r.globalIndex}`;
    },
  });
  const items = virtualizer.getVirtualItems();
  const activeSticky = lastHeaderAtOrBefore(headerIndexes, virtualizer.range?.startIndex ?? 0);
  // The sticky header of the last commit. Its transform changes type when it stops sticking, so it must not glide.
  const stickyBefore = useRef<number | null>(null);
  useEffect(() => {
    stickyBefore.current = activeSticky;
  });

  // Load pages as placeholders (or the end of the list) scroll into view.
  const lastItemIndex = items[items.length - 1]?.index ?? -1;
  useEffect(() => {
    let need = -1;
    for (const it of items) {
      const r = rows[it.index];
      if (r?.type === 'placeholder') need = Math.max(need, r.globalIndex);
    }
    if (need >= 0) data.ensureLoaded(need);
    else if (data.hasMore && lastItemIndex >= rows.length - 8) data.ensureLoaded(data.loadedCount);
  }, [items, rows, data, lastItemIndex]);

  const indexByIdRef = useRef(indexById);
  useEffect(() => {
    indexByIdRef.current = indexById;
  });
  // Coming back from the issue page: same scroll offset, same row focused (U1).
  const ready = !data.initialLoading && rows.length > 0;
  useEffect(() => {
    const mem = restore.current;
    const el = scrollRef.current;
    if (!mem || !ready || !el) return;
    restore.current = null;
    forgetListMemory(listId);
    if (el.scrollTop !== mem.scrollTop) el.scrollTop = mem.scrollTop;
    if (mem.focusedId && indexByIdRef.current.has(mem.focusedId)) {
      domFocusPending.current = true;
      setFocused(mem.focusedId);
    }
    // StrictMode re-runs effects after a simulated unmount (which clears the active list): re-arm.
    // `ready` only flips once, so this never re-applies after a refetch.
    return () => {
      restore.current = mem;
    };
  }, [ready, setFocused, listId]);

  /** Open the full page with this list as its context (U1). */
  const openFull = useCallback(
    (id: string) => {
      const issue = issues.find((i) => i.id === id);
      openIssue(id, { fromList: listId, identifier: issue?.identifier, scrollTop: scrollRef.current?.scrollTop ?? 0 });
    },
    [issues, openIssue, listId],
  );

  // Keep the focused row in view and give it DOM focus after keyboard moves.
  useEffect(() => {
    if (!focusedId) return;
    const idx = indexById.get(focusedId);
    if (idx === undefined) return;
    if (domFocusPending.current) {
      virtualizer.scrollToIndex(idx, { align: 'auto' });
      requestAnimationFrame(() => {
        domFocusPending.current = false;
        // Never steal focus from something opened in the meantime (a shortcut popup, the palette).
        const active = document.activeElement;
        if (active && active !== document.body && !scrollRef.current?.contains(active)) return;
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-issue-row="${CSS.escape(focusedId)}"]`);
        el?.focus({ preventScroll: true });
      });
    }
  }, [focusedId, indexById, virtualizer]);

  const move = (delta: 1 | -1) => {
    if (order.length === 0) return;
    const cur = focusedId ? order.indexOf(focusedId) : -1;
    const nextIdx = cur === -1 ? (delta === 1 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, cur + delta));
    const next = order[nextIdx];
    if (!next) return;
    domFocusPending.current = true;
    setFocused(next);
    // Linear parity: with the panel open, J/K walks the panel along.
    if (panelIssueId && panelIssueId !== next) openIssue(next);
  };

  const { drop, reorder } = useIssueDrop(issues, grouping, Boolean(reorderable));

  /** Neighbors of `id` inside its group after moving it by `delta`. */
  const reorderBy = (id: string, delta: 1 | -1) => {
    const idx = indexById.get(id);
    if (idx === undefined) return;
    const row = rows[idx];
    if (row?.type !== 'issue') return;
    const groupIds = rows.flatMap((r) => (r.type === 'issue' && r.groupKey === row.groupKey ? [r.issue.id] : []));
    const pos = groupIds.indexOf(id);
    const target = pos + delta;
    if (target < 0 || target >= groupIds.length) return;
    const without = groupIds.filter((x) => x !== id);
    const beforeId = without[target - 1] ?? null;
    const afterId = without[target] ?? null;
    domFocusPending.current = true;
    void reorder({ id, afterId, beforeId });
  };

  const isActiveList = () => useActiveList.getState().listId === listId;

  useCommands(
    () => [
      { id: 'list.down', title: m.cmd.moveDown, group: 'list', keys: ['j', 'arrowdown'], scope: 'list', repeat: true, palette: false, when: isActiveList, run: () => move(1) },
      { id: 'list.up', title: m.cmd.moveUp, group: 'list', keys: ['k', 'arrowup'], scope: 'list', repeat: true, palette: false, when: isActiveList, run: () => move(-1) },
      {
        id: 'list.open',
        title: m.cmd.openIssue,
        group: 'list',
        keys: ['enter'],
        scope: 'list',
        palette: false,
        when: () => isActiveList() && Boolean(useActiveList.getState().focusedId),
        run: () => {
          const id = useActiveList.getState().focusedId;
          if (id) openFull(id);
        },
      },
      {
        id: 'list.openFull',
        title: m.cmd.openFullPage,
        group: 'list',
        keys: ['mod+enter'],
        scope: 'list',
        palette: false,
        when: () => isActiveList() && Boolean(useActiveList.getState().focusedId),
        run: () => {
          const id = useActiveList.getState().focusedId;
          if (id) openFull(id);
        },
      },
      {
        id: 'list.peek',
        title: m.cmd.peekIssue,
        group: 'list',
        keys: ['space'],
        scope: 'list',
        palette: false,
        when: () => isActiveList() && Boolean(useActiveList.getState().focusedId) && spaceTargetOk(),
        run: () => {
          const id = useActiveList.getState().focusedId;
          if (!id) return;
          if (panelIssueId === id) closePanel();
          else openIssue(id, { peek: true });
        },
      },
      {
        id: 'list.select',
        title: m.cmd.toggleSelect,
        group: 'selection',
        keys: ['x'],
        scope: 'list',
        when: () => isActiveList() && Boolean(useActiveList.getState().focusedId),
        run: () => {
          const id = useActiveList.getState().focusedId;
          if (id) toggle(id);
        },
      },
      {
        id: 'list.range',
        title: m.cmd.rangeSelect,
        group: 'selection',
        keys: ['shift+x'],
        scope: 'list',
        when: () => isActiveList() && Boolean(useActiveList.getState().focusedId),
        run: () => {
          const id = useActiveList.getState().focusedId;
          if (id) range(id, order);
        },
      },
      {
        id: 'list.selectAll',
        title: m.cmd.selectAll,
        group: 'selection',
        keys: ['mod+a'],
        scope: 'list',
        when: isActiveList,
        run: () => setSelection(order),
      },
      {
        id: 'list.reorderUp',
        title: m.cmd.reorderUp,
        group: 'list',
        keys: ['alt+arrowup'],
        scope: 'list',
        when: () => Boolean(reorderable) && isActiveList() && Boolean(useActiveList.getState().focusedId),
        run: () => {
          const id = useActiveList.getState().focusedId;
          if (id) reorderBy(id, -1);
        },
      },
      {
        id: 'list.reorderDown',
        title: m.cmd.reorderDown,
        group: 'list',
        keys: ['alt+arrowdown'],
        scope: 'list',
        when: () => Boolean(reorderable) && isActiveList() && Boolean(useActiveList.getState().focusedId),
        run: () => {
          const id = useActiveList.getState().focusedId;
          if (id) reorderBy(id, 1);
        },
      },
    ],
  );

  const onRowClick = useCallback(
    (issue: IssueRowFieldsFragment, e: MouseEvent<HTMLDivElement>) => {
      setFocused(issue.id);
      if (e.metaKey || e.ctrlKey) {
        toggle(issue.id);
        return;
      }
      if (e.shiftKey) {
        range(issue.id, order);
        return;
      }
      openFull(issue.id);
    },
    [setFocused, toggle, range, order, openFull],
  );
  const onRowContextMenu = useCallback(
    (issue: IssueRowFieldsFragment, e: MouseEvent<HTMLDivElement>) => {
      setFocused(issue.id);
      openRowContextMenu(issue.id, e);
    },
    [setFocused],
  );
  const onToggleSelect = useCallback(
    (issue: IssueRowFieldsFragment, shift: boolean) => {
      setFocused(issue.id);
      if (shift) range(issue.id, order);
      else toggle(issue.id);
    },
    [setFocused, range, toggle, order],
  );
  const onFocusRow = useCallback((issue: IssueRowFieldsFragment) => setFocused(issue.id), [setFocused]);

  // Drag: rows reorder under manual ordering, and move between groups when the grouping field is set by the drop.
  const draggable = canDragIssues(grouping, Boolean(reorderable));
  // Dragged ids (the whole selection when the dragged row is in it), the group under the pointer, and the slot above/below its row.
  const [drag, setDrag] = useState<{ ids: string[]; over: string | null | undefined; overId: string | null; below: boolean } | null>(null);
  const membersOf = (key: string | null) => rows.flatMap((r) => (r.type === 'issue' && r.groupKey === key ? [r.issue.id] : []));
  const onDragStart = (e: DragEvent, issue: IssueRowFieldsFragment) => {
    if (!draggable) return;
    const ids = selected.has(issue.id) ? [...selected] : [issue.id];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ids.join(','));
    setIssueDragPreview(e, issue, ids.length);
    setDrag({ ids, over: undefined, overId: null, below: false });
  };
  const onItemDragOver = (e: DragEvent<HTMLDivElement>, row: ListRow<IssueRowFieldsFragment>) => {
    const key = dropGroupOf(row);
    if (!drag || key === undefined) return;
    e.preventDefault();
    const overId = row.type === 'issue' ? row.issue.id : null;
    const rect = e.currentTarget.getBoundingClientRect();
    const below = overId !== null && e.clientY > rect.top + rect.height / 2;
    if (drag.over !== key || drag.overId !== overId || drag.below !== below) setDrag({ ...drag, over: key, overId, below });
  };
  const onItemDrop = (e: DragEvent<HTMLDivElement>, row: ListRow<IssueRowFieldsFragment>) => {
    const key = dropGroupOf(row);
    const d = drag;
    setDrag(null);
    if (!d || key === undefined) return;
    e.preventDefault();
    if (row.type === 'issue') drop(d.ids, { key, members: membersOf(key), slot: { id: row.issue.id, below: d.below } });
    else drop(d.ids, { key, members: membersOf(key) });
  };

  /** The pointer is over this row's group (its drop target). */
  const overGroup = (row: ListRow<IssueRowFieldsFragment>) => drag !== null && drag.over !== undefined && drag.over === dropGroupOf(row);

  if (data.initialLoading) return <ContentSkeleton rows={16} header={false} />;
  if (rows.length === 0 || (data.total === 0 && !data.hasMore && issues.length === 0)) {
    return <div className="flex flex-1 items-center justify-center">{empty}</div>;
  }

  const selecting = selected.size > 0;

  const renderRow = (row: ListRow<IssueRowFieldsFragment>, index: number, sticky: boolean) => {
    if (row.type === 'header') {
      const info = groupInfo(grouping, row.key, ws, cycleNames);
      return (
        <GroupHeader
          info={info}
          count={row.count}
          collapsed={row.collapsed}
          rowIndex={index}
          sticky={sticky}
          dropTarget={overGroup(row)}
          onToggle={() => onToggleGroup(groupToken(row.key))}
          onCreate={() => openCreate({ ...context, ...info.defaults })}
        />
      );
    }
    if (row.type === 'placeholder') return <PlaceholderRow />;
    const issue = row.issue;
    const dragging = drag?.ids.includes(issue.id) ?? false;
    return (
      <div draggable={draggable} onDragStart={(e) => onDragStart(e, issue)} onDragEnd={() => setDrag(null)} className={clsx('relative', dragging && 'opacity-40')}>
        {drag && drag.overId === issue.id && !dragging ? (
          <div className={clsx('pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary', drag.below ? '-bottom-px' : '-top-px')} />
        ) : null}
        <IssueRow
          issue={issue}
          columns={display.columns}
          focused={focusedId === issue.id}
          selected={selected.has(issue.id)}
          selecting={selecting}
          idWidth={idWidth}
          rowIndex={index}
          addedAfterStart={addedAfterStartIds?.has(issue.id)}
          onRowClick={onRowClick}
          onToggleSelect={onToggleSelect}
          onFocusRow={onFocusRow}
          onContextMenu={onRowContextMenu}
        />
      </div>
    );
  };

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={m.list.issues}
      aria-rowcount={rows.length}
      aria-multiselectable="true"
      data-testid="issue-list"
      className={clsx('scrollbar-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain', className)}
      onPointerDown={() => {
        if (useActiveList.getState().listId !== listId) setList(listId, order, context ? { teamId: context.teamId } : null);
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {items.map((it) => {
          const row = rows[it.index];
          if (!row) return null;
          const isSticky = it.index === activeSticky;
          // Rows glide to a new slot when the list reorders (a drop, a status change, a collapse above). Slots only change
          // on reorders: scrolling leaves them alone, and a fresh element never transitions. Off mid-drag and for sticky headers.
          const glide = drag === null && !isSticky && it.index !== stickyBefore.current;
          return (
            <div
              key={it.key}
              data-index={it.index}
              onDragOver={drag ? (e) => onItemDragOver(e, row) : undefined}
              onDrop={drag ? (e) => onItemDrop(e, row) : undefined}
              className={clsx(overGroup(row) && 'bg-hover', glide && 'issue-row-glide')}
              style={
                isSticky
                  ? { position: 'sticky', top: 0, zIndex: 2, height: ROW_HEIGHT }
                  : { position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_HEIGHT, transform: `translateY(${it.start}px)` }
              }
            >
              {renderRow(row, it.index, isSticky)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
