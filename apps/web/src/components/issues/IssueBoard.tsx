import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { Avatar, Icon, IconButton, PriorityIcon, Spinner, StatusIcon, priorityNames } from '@velocity/ui';
import type { IssueRowFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useCommands } from '@/keyboard/react';
import { useActiveList } from '@/stores/list';
import { useSelection } from '@/stores/selection';
import { useUi } from '@/stores/ui';
import type { CreateDefaults, PickerKind } from '@/stores/ui';
import { usePulse } from '@/stores/sync';
import type { GroupBy, IssueGroup } from '@/lib/grouping';
import { useClosePanel, useOpenIssue, usePanelIssueId } from '@/lib/navigation';
import { forgetListMemory, listReturnPath, peekListMemory } from '@/lib/issueNav';
import { setIssueDragPreview } from '@/lib/dragPreview';
import { useLocation } from 'react-router-dom';
import { openRowContextMenu, spaceTargetOk } from './rowActions';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';
import { groupInfo } from './GroupHeader';
import { LabelChips } from './LabelChips';
import { InlineProp } from './InlineProp';
import { PRIORITY_KEYS } from './IssueRow';
import { useIssueDrop } from './useIssueDrop';
import { useLoadWhenVisible } from './useLoadWhenVisible';
import type { IssueListResult } from './useIssueList';
import { useFeatures } from '@/lib/features';
import { m } from '@/i18n';

/** Initial card height; the virtualizer measures each card once it renders. */
const CARD_ESTIMATE = 124;
const CARD_GAP = 8;
const BOARD_PAGE = 400;

/** Board drag: the dragged ids, the column under the pointer, and the card above/below it. */
interface BoardDrag {
  ids: string[];
  over: string | null | undefined;
  overId: string | null;
  below: boolean;
}

const PICKER_FOR: Partial<Record<GroupBy, PickerKind>> = {
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  project: 'project',
  cycle: 'cycle',
  label: 'labels',
  team: 'team',
};

interface CardProps {
  issue: IssueRowFieldsFragment;
  focused: boolean;
  selected: boolean;
  onClick: (issue: IssueRowFieldsFragment, e: ReactMouseEvent) => void;
  onFocus: (issue: IssueRowFieldsFragment) => void;
  onDragStart: (e: DragEvent, issue: IssueRowFieldsFragment) => void;
  onContextMenu: (issue: IssueRowFieldsFragment, e: ReactMouseEvent<HTMLDivElement>) => void;
}

const BoardCard = memo(function BoardCard({ issue, focused, selected, onClick, onFocus, onDragStart, onContextMenu }: CardProps) {
  const pulse = usePulse(issue.id);
  const estimates = useFeatures().estimates;
  return (
    <div
      role="button"
      tabIndex={focused ? 0 : -1}
      draggable
      data-issue-row={issue.id}
      data-testid="board-card"
      aria-pressed={selected}
      aria-label={m.list.rowLabel(issue.identifier, issue.title)}
      onClick={(e) => onClick(issue, e)}
      onFocus={() => onFocus(issue)}
      onContextMenu={(e) => onContextMenu(issue, e)}
      onDragStart={(e) => onDragStart(e, issue)}
      className={clsx(
        'flex cursor-default select-none flex-col gap-1.5 rounded-md border bg-raised p-3 text-base outline-none transition-colors duration-100',
        selected ? 'border-primary bg-primary-subtle' : focused ? 'border-primary' : 'border-border hover:border-border-input hover:bg-overlay',
        pulse !== undefined && 'sync-pulse',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="identifier">{issue.identifier}</span>
        <span className="flex-1" />
        <InlineProp
          kind="assignee"
          issueId={issue.id}
          label={`${m.issue.assignee}: ${issue.assignee?.name ?? m.issue.noAssignee}`}
          className="h-6 w-6 rounded-full"
        >
          {issue.assignee ? (
            <Avatar name={issue.assignee.name} src={issue.assignee.avatarUrl} size={20} />
          ) : (
            <Icon name="user" className="text-fg-subtlest opacity-60" />
          )}
        </InlineProp>
      </div>
      <div data-testid="board-card-title" className="line-clamp-2 shrink-0 font-medium text-fg">
        {issue.title}
      </div>
      <div className="flex items-center gap-1.5">
        <InlineProp
          kind="priority"
          issueId={issue.id}
          label={`${m.issue.priority}: ${priorityNames[PRIORITY_KEYS[issue.priority] ?? 'none']}`}
          className="h-6 w-6"
        >
          <PriorityIcon priority={PRIORITY_KEYS[issue.priority] ?? 'none'} label="" />
        </InlineProp>
        <InlineProp kind="status" issueId={issue.id} label={`${m.issue.status}: ${issue.status.name}`} className="h-6 w-6">
          <StatusIcon category={issue.status.category} color={issue.status.color} label="" />
        </InlineProp>
        {issue.labels.length > 0 ? (
          <InlineProp kind="labels" issueId={issue.id} label={`${m.issue.labels}: ${issue.labels.map((l) => l.name).join(', ')}`} className="rounded-full">
            <LabelChips labels={issue.labels} max={1} />
          </InlineProp>
        ) : null}
        {estimates && issue.estimate !== null ? (
          <InlineProp
            kind="estimate"
            issueId={issue.id}
            label={`${m.issue.estimate}: ${issue.estimate}`}
            className="h-5 min-w-5 rounded-full border border-border px-1.5 text-sm tabular-nums text-fg-subtle hover:text-fg"
          >
            {issue.estimate}
          </InlineProp>
        ) : null}
      </div>
    </div>
  );
});

interface ColumnProps {
  group: IssueGroup<IssueRowFieldsFragment>;
  grouping: GroupBy;
  focusedId: string | null;
  selected: ReadonlySet<string>;
  drag: BoardDrag | null;
  context?: CreateDefaults;
  cycleNames?: ReadonlyMap<string, string>;
  onCardClick: (issue: IssueRowFieldsFragment, e: ReactMouseEvent) => void;
  onCardFocus: (issue: IssueRowFieldsFragment) => void;
  onCardContextMenu: (issue: IssueRowFieldsFragment, e: ReactMouseEvent<HTMLDivElement>) => void;
  onDragStart: (e: DragEvent, issue: IssueRowFieldsFragment) => void;
  /** Hovering the column (`slot` null) or a card in it (`slot` is that card and whether the drop goes below it). */
  onDragOver: (key: string | null, slot: { id: string; below: boolean } | null) => void;
  onDrop: (key: string | null) => void;
  /** Loads the next page; called while this column's "loading more" placeholder is on screen. */
  onNeedMore: () => void;
  /** Issues loaded so far (all columns); re-arms `onNeedMore` after each page. */
  loadedCount: number;
}

function BoardColumn({ group, grouping, focusedId, selected, drag, context, cycleNames, onCardClick, onCardFocus, onCardContextMenu, onDragStart, onDragOver, onDrop, onNeedMore, loadedCount }: ColumnProps) {
  const ws = useWorkspace();
  const openCreate = useUi((s) => s.openCreate);
  const info = groupInfo(grouping, group.key, ws, cycleNames);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The board loads issues eagerly up to a cap; a column whose issues come later in the server
  // order keeps loading pages while its placeholder is visible (large teams, done=all).
  const moreRef = useRef<HTMLDivElement | null>(null);
  useLoadWhenVisible(moreRef, group.unloaded > 0, onNeedMore, loadedCount);
  // Cards size to their content: each is measured once rendered (data-index + measureElement).
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is used as documented.
  const virtualizer = useVirtualizer({
    count: group.issues.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_ESTIMATE,
    gap: CARD_GAP,
    overscan: 6,
  });
  const focusedIndex = focusedId ? group.issues.findIndex((i) => i.id === focusedId) : -1;
  useEffect(() => {
    if (focusedIndex >= 0) virtualizer.scrollToIndex(focusedIndex, { align: 'auto' });
  }, [focusedIndex, virtualizer]);

  return (
    <section
      aria-label={info.label}
      data-testid="board-column"
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(group.key, null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(group.key);
      }}
      className={clsx(
        'group/column flex h-full w-80 shrink-0 flex-col rounded-md border transition-colors duration-100',
        drag !== null && drag.over === group.key ? 'border-primary bg-primary-subtle' : 'border-transparent',
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 px-2">
        <span className="flex w-4 justify-center">{info.icon}</span>
        <span className="truncate text-base font-medium text-fg">{info.label}</span>
        <span className="text-base tabular-nums text-fg-subtlest">{group.count}</span>
        <span className="flex-1" />
        <span className="opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover/column:opacity-100">
          <IconButton label={m.issue.newIssue} size="sm" icon={<Icon name="add" />} onClick={() => openCreate({ ...context, ...info.defaults })} />
        </span>
      </div>
      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-0.5 pb-2">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((it) => {
            const issue = group.issues[it.index];
            if (!issue) return null;
            const dragging = drag?.ids.includes(issue.id) ?? false;
            return (
              <div
                key={issue.id}
                ref={virtualizer.measureElement}
                data-index={it.index}
                className={clsx(dragging && 'opacity-40')}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${it.start}px)` }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  onDragOver(group.key, { id: issue.id, below: e.clientY > rect.top + rect.height / 2 });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDrop(group.key);
                }}
              >
                {drag && drag.overId === issue.id && !dragging ? (
                  <div className={clsx('pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary', drag.below ? '-bottom-px' : '-top-px')} />
                ) : null}
                <BoardCard issue={issue} focused={issue.id === focusedId} selected={selected.has(issue.id)} onClick={onCardClick} onFocus={onCardFocus} onDragStart={onDragStart} onContextMenu={onCardContextMenu} />
              </div>
            );
          })}
        </div>
        {group.unloaded > 0 ? (
          // SPEC §4.9.11: a 16px spinner beside the text for a component fetch.
          <div ref={moreRef} role="status" className="flex h-9 items-center justify-center gap-2 text-sm text-fg-subtle" data-testid="board-loading-more">
            <Spinner size={16} label="" />
            {m.list.loadingMore}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export interface IssueBoardProps {
  listId: string;
  data: IssueListResult;
  grouping: GroupBy;
  /** Manual ordering: a card dropped between two cards takes that position. */
  reorderable?: boolean;
  context?: CreateDefaults;
  cycleNames?: ReadonlyMap<string, string>;
  empty: ReactNode;
}

/** Board layout (SPEC §4.11.1): columns per group, drag and drop, keyboard ←/→/↑/↓ and M. */
export function IssueBoard({ listId, data, grouping, reorderable, context, cycleNames, empty }: IssueBoardProps) {
  const groups = data.groups;
  const { ensureLoaded, loadedCount } = data;
  // Ask for a generous page: the columns that wait are the ones furthest down the server order.
  const loadMore = useCallback(() => ensureLoaded(loadedCount + BOARD_PAGE), [ensureLoaded, loadedCount]);
  const { drop } = useIssueDrop(data.issues, grouping, Boolean(reorderable));
  const openIssue = useOpenIssue();
  const closePanel = useClosePanel();
  const panelIssueId = usePanelIssueId();
  const openPicker = useUi((s) => s.openPicker);
  const location = useLocation();
  const restore = useRef<ReturnType<typeof peekListMemory> | undefined>(undefined);
  if (restore.current === undefined) restore.current = peekListMemory(listId, listReturnPath(location.pathname, location.search));
  const focusedId = useActiveList((s) => (s.listId === listId ? s.focusedId : null));
  const setList = useActiveList((s) => s.setList);
  const clearList = useActiveList((s) => s.clearList);
  const setFocused = useActiveList((s) => s.setFocused);
  const selected = useSelection((s) => s.selected);
  const toggle = useSelection((s) => s.toggle);
  const range = useSelection((s) => s.range);
  const setSelection = useSelection((s) => s.set);
  const [drag, setDrag] = useState<BoardDrag | null>(null);

  const order = useMemo(() => groups.flatMap((g) => g.issues.map((i) => i.id)), [groups]);
  useEffect(() => {
    setList(listId, order, context ? { teamId: context.teamId, projectId: context.projectId ?? undefined } : null);
  }, [listId, order, setList, context]);
  useEffect(() => () => clearList(listId), [clearList, listId]);

  const locate = useCallback(
    (id: string | null) => {
      if (!id) return null;
      for (let c = 0; c < groups.length; c++) {
        const r = groups[c]?.issues.findIndex((i) => i.id === id) ?? -1;
        if (r >= 0) return { c, r };
      }
      return null;
    },
    [groups],
  );

  const focusCard = (id: string) => {
    setFocused(id);
    if (panelIssueId && panelIssueId !== id) openIssue(id);
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && !active.closest('[data-testid="issue-board"]')) return;
      document.querySelector<HTMLElement>(`[data-issue-row="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    });
  };

  const moveFocus = (dc: number, dr: number) => {
    const pos = locate(useActiveList.getState().focusedId);
    if (!pos) {
      const first = groups.find((g) => g.issues.length > 0)?.issues[0];
      if (first) focusCard(first.id);
      return;
    }
    let c = pos.c + dc;
    while (c >= 0 && c < groups.length && dc !== 0 && (groups[c]?.issues.length ?? 0) === 0) c += dc;
    const col = groups[Math.max(0, Math.min(groups.length - 1, c))];
    if (!col || col.issues.length === 0) return;
    const r = Math.max(0, Math.min(col.issues.length - 1, dc === 0 ? pos.r + dr : pos.r));
    const target = col.issues[r];
    if (target) focusCard(target.id);
  };

  const isActive = () => useActiveList.getState().listId === listId;

  /** Full page with this board as its list context (U1). */
  const openFull = useCallback(
    (id: string) => {
      const issue = data.issues.find((i) => i.id === id);
      openIssue(id, { fromList: listId, identifier: issue?.identifier });
    },
    [data.issues, openIssue, listId],
  );

  // Back from the issue page: focus the card that was open (U1).
  const ready = order.length > 0;
  const latest = useRef({ order, focusCard });
  useEffect(() => {
    latest.current = { order, focusCard };
  });
  useEffect(() => {
    const mem = restore.current;
    if (!mem || !ready) return;
    restore.current = null;
    forgetListMemory(listId);
    if (mem.focusedId && latest.current.order.includes(mem.focusedId)) latest.current.focusCard(mem.focusedId);
    // StrictMode's simulated unmount clears the active list: re-arm. `ready` flips once.
    return () => {
      restore.current = mem;
    };
  }, [ready, listId]);
  const picker = PICKER_FOR[grouping];

  useCommands(() => [
    { id: 'board.down', title: m.cmd.moveDown, group: 'list', keys: ['j', 'arrowdown'], scope: 'list', repeat: true, palette: false, when: isActive, run: () => moveFocus(0, 1) },
    { id: 'board.up', title: m.cmd.moveUp, group: 'list', keys: ['k', 'arrowup'], scope: 'list', repeat: true, palette: false, when: isActive, run: () => moveFocus(0, -1) },
    { id: 'board.left', title: m.cmd.moveLeft, group: 'list', keys: ['arrowleft'], scope: 'list', repeat: true, palette: false, when: isActive, run: () => moveFocus(-1, 0) },
    { id: 'board.right', title: m.cmd.moveRight, group: 'list', keys: ['arrowright'], scope: 'list', repeat: true, palette: false, when: isActive, run: () => moveFocus(1, 0) },
    {
      id: 'board.open',
      title: m.cmd.openIssue,
      group: 'list',
      keys: ['enter'],
      scope: 'list',
      palette: false,
      when: () => isActive() && Boolean(useActiveList.getState().focusedId),
      run: () => {
        const id = useActiveList.getState().focusedId;
        if (id) openFull(id);
      },
    },
    {
      id: 'board.peek',
      title: m.cmd.peekIssue,
      group: 'list',
      keys: ['space'],
      scope: 'list',
      palette: false,
      when: () => isActive() && Boolean(useActiveList.getState().focusedId) && spaceTargetOk(),
      run: () => {
        const id = useActiveList.getState().focusedId;
        if (!id) return;
        if (panelIssueId === id) closePanel();
        else openIssue(id, { peek: true });
      },
    },
    {
      id: 'board.select',
      title: m.cmd.toggleSelect,
      group: 'selection',
      keys: ['x'],
      scope: 'list',
      when: () => isActive() && Boolean(useActiveList.getState().focusedId),
      run: () => {
        const id = useActiveList.getState().focusedId;
        if (id) toggle(id);
      },
    },
    {
      id: 'board.range',
      title: m.cmd.rangeSelect,
      group: 'selection',
      keys: ['shift+x'],
      scope: 'list',
      when: () => isActive() && Boolean(useActiveList.getState().focusedId),
      run: () => {
        const id = useActiveList.getState().focusedId;
        if (id) range(id, order);
      },
    },
    {
      id: 'board.selectAll',
      title: m.cmd.selectAll,
      group: 'selection',
      keys: ['mod+a'],
      scope: 'list',
      when: isActive,
      run: () => setSelection(order),
    },
    {
      id: 'board.moveColumn',
      title: m.cmd.moveColumn,
      group: 'issue',
      keys: ['m'],
      scope: 'list',
      when: () => isActive() && Boolean(picker) && Boolean(useActiveList.getState().focusedId),
      run: () => {
        const id = useActiveList.getState().focusedId;
        if (!id || !picker) return;
        const sel = useSelection.getState().selected;
        openPicker({ kind: picker, issueIds: sel.size > 0 ? [...sel] : [id], anchor: document.querySelector<HTMLElement>(`[data-issue-row="${CSS.escape(id)}"]`) });
      },
    },
  ]);

  // Same modifiers as the list rows: ⌘/Ctrl toggles, ⇧ selects from the anchor in board reading order.
  const onCardClick = useCallback(
    (issue: IssueRowFieldsFragment, e: ReactMouseEvent) => {
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
  const onCardContextMenu = useCallback(
    (issue: IssueRowFieldsFragment, e: ReactMouseEvent<HTMLDivElement>) => {
      setFocused(issue.id);
      openRowContextMenu(issue.id, e);
    },
    [setFocused],
  );
  const onDragStart = useCallback((e: DragEvent, issue: IssueRowFieldsFragment) => {
    const sel = useSelection.getState().selected;
    const ids = sel.has(issue.id) ? [...sel] : [issue.id];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ids.join(','));
    setIssueDragPreview(e, issue, ids.length);
    setDrag({ ids, over: undefined, overId: null, below: false });
  }, []);
  const onDragOverColumn = (key: string | null, slot: { id: string; below: boolean } | null) => {
    if (!drag) return;
    const overId = slot?.id ?? null;
    const below = slot?.below ?? false;
    if (drag.over !== key || drag.overId !== overId || drag.below !== below) setDrag({ ...drag, over: key, overId, below });
  };
  const onDrop = (key: string | null) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    const members = groups.find((g) => g.key === key)?.issues.map((i) => i.id) ?? [];
    drop(d.ids, { key, members, slot: d.overId ? { id: d.overId, below: d.below } : undefined });
  };

  if (data.initialLoading) return <ContentSkeleton rows={10} header={false} />;
  if (data.total === 0 && groups.every((g) => g.issues.length === 0)) return <div className="flex flex-1 items-center justify-center">{empty}</div>;

  return (
    <div
      className="scrollbar-thin flex min-h-0 flex-1 gap-2 overflow-x-auto px-3 py-2"
      data-testid="issue-board"
      onDragEnd={() => setDrag(null)}
      onPointerDown={() => setList(listId, order, context ? { teamId: context.teamId } : null)}
    >
      {groups.map((g) => (
        <BoardColumn
          key={g.key ?? '∅'}
          group={g}
          grouping={grouping}
          focusedId={focusedId}
          selected={selected}
          drag={drag}
          context={context}
          cycleNames={cycleNames}
          onCardClick={onCardClick}
          onCardFocus={(issue) => setFocused(issue.id)}
          onCardContextMenu={onCardContextMenu}
          onDragStart={onDragStart}
          onDragOver={onDragOverColumn}
          onDrop={onDrop}
          onNeedMore={loadMore}
          loadedCount={loadedCount}
        />
      ))}
    </div>
  );
}
