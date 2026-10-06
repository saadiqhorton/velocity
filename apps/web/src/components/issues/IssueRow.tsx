import { memo } from 'react';
import type { MouseEvent } from 'react';
import clsx from 'clsx';
import { Avatar, Checkbox, Icon, PriorityIcon, StatusIcon } from '@velocity/ui';
import type { Priority } from '@velocity/ui';
import type { IssueRowFieldsFragment } from '@/gql/graphql';
import type { ColumnKey } from '@/lib/viewState';
import { usePulse } from '@/stores/sync';
import { formatAge, formatShortDate } from '@/lib/format';
import { LabelChips } from './LabelChips';
import { useWorkspace } from '@/app/workspace';
import { ProjectIcon } from '@/components/common/EntityIcons';
import { useFeatures } from '@/lib/features';
import { m } from '@/i18n';

export const PRIORITY_KEYS: Record<number, Priority> = { 0: 'urgent', 1: 'high', 2: 'medium', 3: 'low', 4: 'none' };

export interface IssueRowProps {
  issue: IssueRowFieldsFragment;
  columns: readonly ColumnKey[];
  focused: boolean;
  selected: boolean;
  /** Selection mode shows checkboxes on every row. */
  selecting: boolean;
  /** Identifier column width in ch so ids align across the list. */
  idWidth: number;
  rowIndex: number;
  /** Cycle scope marker: the issue was added after the cycle started (SPEC §3.8). */
  addedAfterStart?: boolean;
  onRowClick: (issue: IssueRowFieldsFragment, e: MouseEvent<HTMLDivElement>) => void;
  onToggleSelect: (issue: IssueRowFieldsFragment, shift: boolean) => void;
  onFocusRow: (issue: IssueRowFieldsFragment) => void;
  /** Right-click (and the Menu key): the issue context menu (U2). */
  onContextMenu?: (issue: IssueRowFieldsFragment, e: MouseEvent<HTMLDivElement>) => void;
}

/**
 * Issue row (SPEC §4.10.2): 32px, single line — priority, mono identifier, status,
 * title, right-aligned metadata (condensed label lozenges, 20px assignee avatar).
 * Hover = sunken surface; focus = 2px left primary indicator; selected = primary-subtle.
 */
export const IssueRow = memo(function IssueRow({
  issue,
  columns,
  focused,
  selected,
  selecting,
  idWidth,
  rowIndex,
  addedAfterStart,
  onRowClick,
  onToggleSelect,
  onFocusRow,
  onContextMenu,
}: IssueRowProps) {
  const pulse = usePulse(issue.id);
  const { projectsById } = useWorkspace();
  const features = useFeatures();
  const has = (c: ColumnKey) => columns.includes(c) && (c !== 'cycle' || features.cycles) && (c !== 'estimate' || features.estimates);
  const project = issue.projectId ? projectsById.get(issue.projectId) : undefined;
  const rollup = issue.subIssueRollup;

  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 1}
      aria-selected={selected}
      aria-label={m.list.rowLabel(issue.identifier, issue.title)}
      data-issue-row={issue.id}
      data-testid="issue-row"
      tabIndex={focused ? 0 : -1}
      onClick={(e) => onRowClick(issue, e)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(issue, e) : undefined}
      onFocus={() => {
        if (!focused) onFocusRow(issue);
      }}
      className={clsx(
        // Container queries: metadata gives way to the title when the list is narrow (panel open, 1024).
        '@container/row group/row relative flex h-8 cursor-default select-none items-center gap-2 pl-1 pr-5 text-base outline-none',
        'before:absolute before:inset-y-0 before:left-0 before:w-0.5',
        selected ? 'bg-primary-subtle' : focused ? 'bg-sunken' : 'hover:bg-sunken',
        focused ? 'before:bg-primary' : 'before:bg-transparent',
        'focus-visible:outline-none',
        pulse !== undefined && 'sync-pulse',
      )}
    >
      <div role="gridcell" className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={clsx(
            'flex h-5 w-5 shrink-0 items-center justify-center',
            selecting || selected ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
          )}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(issue, e.shiftKey);
          }}
        >
          <Checkbox
            tabIndex={-1}
            aria-label={issue.identifier}
            checked={selected}
            onChange={() => undefined}
          />
        </span>
        {has('priority') ? <PriorityIcon priority={PRIORITY_KEYS[issue.priority] ?? 'none'} /> : null}
        {has('identifier') ? (
          <span className="identifier shrink-0 truncate" style={{ width: `${idWidth}ch` }}>
            {issue.identifier}
          </span>
        ) : null}
        {has('status') ? <StatusIcon category={issue.status.category} color={issue.status.color} label={issue.status.name} /> : null}
        {addedAfterStart ? (
          <span className="flex shrink-0 items-center" data-testid="added-after-start-marker" title={m.cycles.addedAfterStart}>
            <Icon name="add" className="h-3 w-3 text-fg-subtlest" label={m.cycles.addedAfterStart} />
          </span>
        ) : null}
        <span className="min-w-0 truncate text-fg">{issue.title}</span>
        {rollup.total > 0 ? (
          <span className="flex shrink-0 items-center gap-1 text-sm text-fg-subtlest" title={m.issue.subIssues}>
            <Icon name="sub-issue" className="h-3 w-3" />
            {m.issue.subIssueRollup(rollup.done, rollup.total)}
          </span>
        ) : null}
      </div>
      <div role="gridcell" className="flex shrink-0 items-center gap-2 pl-2">
        {has('labels') && issue.labels.length > 0 ? (
          <span className="hidden @xl/row:flex">
            <LabelChips labels={issue.labels} max={2} />
          </span>
        ) : null}
        {has('project') && project ? (
          <span className="hidden max-w-36 items-center gap-1 truncate rounded-sm border border-border px-1.5 text-sm text-fg-subtle @3xl/row:flex">
            <ProjectIcon project={project} />
            <span className="truncate">{project.name}</span>
          </span>
        ) : null}
        {has('cycle') && issue.cycle ? (
          <span className="hidden items-center gap-1 text-sm text-fg-subtle @3xl/row:flex">
            <Icon name="cycle" className="h-3 w-3" />
            {issue.cycle.number}
          </span>
        ) : null}
        {has('estimate') && issue.estimate !== null ? (
          <span className="min-w-5 rounded-sm border border-border px-1 text-center text-sm text-fg-subtle">{issue.estimate}</span>
        ) : null}
        {has('created') ? (
          <span className="w-12 text-right text-sm text-fg-subtlest" title={formatShortDate(issue.createdAt)}>
            {formatAge(issue.createdAt)}
          </span>
        ) : null}
        {has('updated') ? (
          <span className="w-12 text-right text-sm text-fg-subtlest" title={formatShortDate(issue.updatedAt)}>
            {formatAge(issue.updatedAt)}
          </span>
        ) : null}
        {has('assignee') ? (
          <span className="flex w-5 justify-center">
            {issue.assignee ? (
              <Avatar name={issue.assignee.name} src={issue.assignee.avatarUrl} size={20} />
            ) : (
              <Icon name="user" className="text-fg-subtlest opacity-60" label={m.issue.noAssignee} />
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
});

export function PlaceholderRow() {
  return (
    <div className="flex h-8 items-center gap-2 pl-7 pr-5" aria-hidden="true">
      <span className="h-3 w-3 rounded-sm bg-neutral" />
      <span className="h-2.5 w-12 rounded-sm bg-neutral" />
      <span className="h-2.5 w-1/3 rounded-sm bg-neutral" />
    </div>
  );
}
