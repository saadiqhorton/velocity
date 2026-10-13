import { memo } from 'react';
import type { MouseEvent } from 'react';
import clsx from 'clsx';
import { Avatar, Checkbox, Icon, PriorityIcon, StatusIcon, priorityNames } from '@velocity/ui';
import type { Priority } from '@velocity/ui';
import type { IssueRowFieldsFragment } from '@/gql/graphql';
import type { ColumnKey } from '@/lib/viewState';
import { usePulse } from '@/stores/sync';
import { formatAge, formatShortDate } from '@/lib/format';
import { LabelChips } from './LabelChips';
import { InlineProp } from './InlineProp';
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
 * Issue row (SPEC §4.10.2): 36px, single line — priority, identifier, status, title,
 * right-aligned metadata (pill labels, project, 20px assignee avatar). Every property is
 * an InlineProp: click it to change it in place. Hover = hover surface; focus = 2px left
 * primary indicator; selected = primary-subtle.
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
  const priorityKey = PRIORITY_KEYS[issue.priority] ?? 'none';
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
        '@container/row group/row relative flex h-9 cursor-default select-none items-center gap-2.5 pl-1 pr-5 text-base outline-none transition-colors duration-100',
        'before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full',
        selected ? 'bg-primary-subtle' : focused ? 'bg-neutral' : 'hover:bg-hover',
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
        {has('priority') ? (
          <InlineProp kind="priority" issueId={issue.id} label={`${m.issue.priority}: ${priorityNames[priorityKey]}`} className="h-6 w-6">
            <PriorityIcon priority={priorityKey} label="" />
          </InlineProp>
        ) : null}
        {has('identifier') ? (
          <span className="identifier shrink-0 truncate" style={{ width: `${idWidth + 0.5}ch` }}>
            {issue.identifier}
          </span>
        ) : null}
        {has('status') ? (
          <InlineProp kind="status" issueId={issue.id} label={`${m.issue.status}: ${issue.status.name}`} className="h-6 w-6">
            <StatusIcon category={issue.status.category} color={issue.status.color} label="" />
          </InlineProp>
        ) : null}
        {addedAfterStart ? (
          <span className="flex shrink-0 items-center" data-testid="added-after-start-marker" title={m.cycles.addedAfterStart}>
            <Icon name="add" className="h-3 w-3 text-fg-subtlest" label={m.cycles.addedAfterStart} />
          </span>
        ) : null}
        <span className="min-w-0 truncate font-medium text-fg">{issue.title}</span>
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
            <InlineProp kind="labels" issueId={issue.id} label={`${m.issue.labels}: ${issue.labels.map((l) => l.name).join(', ')}`} className="rounded-full">
              <LabelChips labels={issue.labels} max={2} />
            </InlineProp>
          </span>
        ) : null}
        {has('project') && project ? (
          <span className="hidden @3xl/row:flex">
            <InlineProp
              kind="project"
              issueId={issue.id}
              label={`${m.issue.project}: ${project.name}`}
              className="h-5 max-w-36 gap-1.5 rounded-full border border-border px-2 text-sm text-fg-subtle hover:text-fg"
            >
              <ProjectIcon project={project} />
              <span className="truncate">{project.name}</span>
            </InlineProp>
          </span>
        ) : null}
        {has('cycle') && issue.cycle ? (
          <span className="hidden @3xl/row:flex">
            <InlineProp
              kind="cycle"
              issueId={issue.id}
              label={`${m.issue.cycle}: ${issue.cycle.number}`}
              className="h-5 gap-1 px-1 text-sm text-fg-subtle hover:text-fg"
            >
              <Icon name="cycle" className="h-3 w-3" />
              {issue.cycle.number}
            </InlineProp>
          </span>
        ) : null}
        {has('estimate') && issue.estimate !== null ? (
          <InlineProp
            kind="estimate"
            issueId={issue.id}
            label={`${m.issue.estimate}: ${issue.estimate}`}
            className="h-5 min-w-5 rounded-full border border-border px-1.5 text-sm tabular-nums text-fg-subtle hover:text-fg"
          >
            {issue.estimate}
          </InlineProp>
        ) : null}
        {has('created') ? (
          <span className="w-12 text-right text-sm tabular-nums text-fg-subtlest" title={formatShortDate(issue.createdAt)}>
            {formatAge(issue.createdAt)}
          </span>
        ) : null}
        {has('updated') ? (
          <span className="w-12 text-right text-sm tabular-nums text-fg-subtlest" title={formatShortDate(issue.updatedAt)}>
            {formatAge(issue.updatedAt)}
          </span>
        ) : null}
        {has('assignee') ? (
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
        ) : null}
      </div>
    </div>
  );
});

export function PlaceholderRow() {
  return (
    <div className="flex h-9 items-center gap-2 pl-7 pr-5" aria-hidden="true">
      <span className="h-3 w-3 rounded-sm bg-neutral" />
      <span className="h-2.5 w-12 rounded-sm bg-neutral" />
      <span className="h-2.5 w-1/3 rounded-sm bg-neutral" />
    </div>
  );
}
