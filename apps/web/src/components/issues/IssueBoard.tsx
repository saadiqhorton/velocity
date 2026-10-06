import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { Avatar, Icon, IconButton, PriorityIcon, Spinner, StatusIcon } from '@velocity/ui';
import type { IssueRowFieldsFragment, UpdateIssueInput } from '@/gql/graphql';
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
import { useLocation } from 'react-router-dom';
import { openRowContextMenu, spaceTargetOk } from './rowActions';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';
import { groupInfo } from './GroupHeader';
import { LabelChips } from './LabelChips';
import { PRIORITY_KEYS } from './IssueRow';
import { useUpdateIssues } from './actions';
import { useLoadWhenVisible } from './useLoadWhenVisible';
import type { IssueListResult } from './useIssueList';
import { useFeatures } from '@/lib/features';
import { m } from '@/i18n';

const CARD_HEIGHT = 96;
const CARD_GAP = 8;
const BOARD_PAGE = 400;

/** Field update that moves an issue into the column `key` of `grouping`. */
export function columnPatch(grouping: GroupBy, key: string | null): UpdateIssueInput | null {
  switch (grouping) {
    case 'status':
      return key ? { statusId: key } : null;
    case 'priority':
      return { priority: key === null ? 4 : Number(key) };
    case 'assignee':
      return { assigneeId: key };
    case 'project':
      return { projectId: key };
    case 'cycle':
      return { cycleId: key };
    case 'label':
      return key ? { addLabelIds: [key] } : null;
    default:
      return null;
  }
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
        'flex h-full cursor-default select-none flex-col gap-1.5 rounded-md border bg-surface p-3 text-base outline-none transition-colors duration-100',
        selected ? 'border-primary bg-primary-subtle' : focused ? 'border-primary' : 'border-border hover:border-border-input',
        pulse !== undefined && 'sync-pulse',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="identifier">{issue.identifier}</span>
        <span className="flex-1" />
        {issue.assignee ? <Avatar name={issue.assignee.name} src={issue.assignee.avatarUrl} size={20} /> : null}
      </div>
      <div className="line-clamp-2 min-h-0 flex-1 text-fg">{issue.title}</div>
      <div className="flex items-center gap-1.5">
        <PriorityIcon priority={PRIORITY_KEYS[issue.priority] ?? 'none'} />
        <StatusIcon category={issue.status.category} color={issue.status.color} label={issue.status.name} />
        {issue.labels.length > 0 ? <LabelChips labels={issue.labels} max={1} /> : null}
        {estimates && issue.estimate !== null ? <span className="rounded-sm border border-border px-1 text-sm text-fg-subtle">{issue.estimate}</span> : null}
      </div>
    </div>
  );
});

interface ColumnProps {
  group: IssueGroup<IssueRowFieldsFragment>;
  grouping: GroupBy;
  focusedId: string | null;
  selected: ReadonlySet<string>;
  dropActive: boolean;
  context?: CreateDefaults;
  cycleNames?: ReadonlyMap<string, string>;
  onCardClick: (issue: IssueRowFieldsFragment, e: ReactMouseEvent) => void;
  onCardFocus: (issue: IssueRowFieldsFragment) => void;
  onCardContextMenu: (issue: IssueRowFieldsFragment, e: ReactMouseEvent<HTMLDivElement>) => void;
  onDragStart: (e: DragEvent, issue: IssueRowFieldsFragment) => void;
  onDragEnter: (key: string | null) => void;
  onDrop: (key: string | null) => void;
  /** Loads the next page; called while this column's "loading more" placeholder is on screen. */
  onNeedMore: () => void;
  /** Issues loaded so far (all columns); re-arms `onNeedMore` after each page. */
  loadedCount: number;
}

function BoardColumn({ group, grouping, focusedId, selected, dropActive, context, cycleNames, onCardClick, onCardFocus, onCardContextMenu, onDragStart, onDragEnter, onDrop, onNeedMore, loadedCount }: ColumnProps) {
  const ws = useWorkspace();
  const openCreate = useUi((s) => s.openCreate);
  const info = groupInfo(grouping, group.key, ws, cycleNames);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The board loads issues eagerly up to a cap; a column whose issues come later in the server
  // order keeps loading pages while its placeholder is visible (large teams, done=all).
  const moreRef = useRef<HTMLDivElement | null>(null);
  useLoadWhenVisible(moreRef, group.unloaded > 0, onNeedMore, loadedCount);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is used as documented.
  const virtualizer = useVirtualizer({
    count: group.issues.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT + CARD_GAP,
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
        onDragEnter(group.key);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(group.key);
      }}
      className={clsx(
        'flex h-full w-72 shrink-0 flex-col rounded-md border transition-colors duration-100',
        dropActive ? 'border-primary bg-primary-subtle' : 'border-transparent bg-sunken',
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <span className="flex w-4 justify-center">{info.icon}</span>
        <span className="truncate text-sm font-semibold text-fg-subtle">{info.label}</span>
        <span className="text-sm text-fg-subtlest">{group.count}</span>
        <span className="flex-1" />
        <IconButton label={m.issue.newIssue} size="sm" icon={<Icon name="add" />} onClick={() => openCreate({ ...context, ...info.defaults })} />
      </div>
      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((it) => {
            const issue = group.issues[it.index];
            if (!issue) return null;
            return (
              <div
                key={issue.id}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: CARD_HEIGHT, transform: `translateY(${it.start}px)` }}
              >
                <BoardCard issue={issue} focused={issue.id === focusedId} selected={selected.has(issue.id)} onClick={onCardClick} onFocus={onCardFocus} onDragStart={onDragStart} onContextMenu={onCardContextMenu} />
              </div>
            );
          })}
        </div>
        {group.unloaded > 0 ? (
          // SPEC §4.9.11: a 16px spinner beside the text for a component fetch.
          <div ref={moreRef} role="status" className="flex h-8 items-center justify-center gap-2 text-sm text-fg-subtle" data-testid="board-loading-more">
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
  context?: CreateDefaults;
  cycleNames?: ReadonlyMap<string, string>;
  empty: ReactNode;
}

/** Board layout (SPEC §4.11.1): columns per group, drag and drop, keyboard ←/→/↑/↓ and M. */
export function IssueBoard({ listId, data, grouping, context, cycleNames, empty }: IssueBoardProps) {
  const groups = data.groups;
  const { ensureLoaded, loadedCount } = data;
  // Ask for a generous page: the columns that wait are the ones furthest down the server order.
  const loadMore = useCallback(() => ensureLoaded(loadedCount + BOARD_PAGE), [ensureLoaded, loadedCount]);
  const update = useUpdateIssues();
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
  const [drag, setDrag] = useState<{ ids: string[]; over: string | null | undefined } | null>(null);

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

  const onCardClick = useCallback(
    (issue: IssueRowFieldsFragment, e: ReactMouseEvent) => {
      setFocused(issue.id);
      if (e.metaKey || e.ctrlKey || e.shiftKey) toggle(issue.id);
      else openFull(issue.id);
    },
    [setFocused, toggle, openFull],
  );
  const onCardContextMenu = useCallback(
    (issue: IssueRowFieldsFragment, e: ReactMouseEvent<HTMLDivElement>) => {
      setFocused(issue.id);
      openRowContextMenu(issue.id, e);
    },
    [setFocused],
  );
  const onDragStart = useCallback(
    (e: DragEvent, issue: IssueRowFieldsFragment) => {
      const sel = useSelection.getState().selected;
      const ids = sel.has(issue.id) ? [...sel] : [issue.id];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ids.join(','));
      setDrag({ ids, over: undefined });
    },
    [],
  );
  const onDrop = (key: string | null) => {
    if (!drag) return;
    const patch = columnPatch(grouping, key);
    const ids = drag.ids.filter((id) => {
      const pos = locate(id);
      return !pos || groups[pos.c]?.key !== key;
    });
    setDrag(null);
    if (patch && ids.length > 0) void update(ids, patch);
  };

  if (data.initialLoading) return <ContentSkeleton rows={10} header={false} />;
  if (data.total === 0 && groups.every((g) => g.issues.length === 0)) return <div className="flex flex-1 items-center justify-center">{empty}</div>;

  return (
    <div
      className="scrollbar-thin flex min-h-0 flex-1 gap-3 overflow-x-auto p-4"
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
          dropActive={drag !== null && drag.over === g.key}
          context={context}
          cycleNames={cycleNames}
          onCardClick={onCardClick}
          onCardFocus={(issue) => setFocused(issue.id)}
          onCardContextMenu={onCardContextMenu}
          onDragStart={onDragStart}
          onDragEnter={(key) => {
            if (drag && drag.over !== key) setDrag({ ...drag, over: key });
          }}
          onDrop={onDrop}
          onNeedMore={loadMore}
          loadedCount={loadedCount}
        />
      ))}
    </div>
  );
}
