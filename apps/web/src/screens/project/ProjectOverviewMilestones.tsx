import { useId, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ConfirmDialog, DropdownMenu, Icon, IconButton, MenuItem, PopupSelect, Tooltip } from '@velocity/ui';
import type { MilestoneStatus } from '@/gql/graphql';
import { formatShortDate } from '@/lib/format';
import { m } from '@/i18n';
import { sortMilestones, useMilestoneActions } from './ProjectMilestones';
import type { Milestone } from './ProjectMilestones';
import { MilestoneIcon, milestoneIssuesHref } from './projectUi';

const STATUSES: MilestoneStatus[] = ['planned', 'in_progress', 'done'];
type Patch = ReturnType<typeof useMilestoneActions>['patch'];

function MilestoneDescription({ milestone, patch }: { milestone: Milestone; patch: Patch }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const canceled = useRef(false);
  const descriptionId = useId();
  const label = `${m.common.description}: ${milestone.name}`;
  if (editing) {
    return (
      <textarea
        autoFocus
        aria-label={label}
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const description = draft.trim();
          if (!canceled.current && description !== (milestone.description ?? '')) void patch(milestone.id, { description: description || null });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            canceled.current = true;
            setEditing(false);
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
        }}
        className="block min-h-16 w-full resize-y rounded-sm border border-border-input bg-surface px-2 py-1 text-base leading-6 text-fg"
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-describedby={descriptionId}
      onClick={() => {
        canceled.current = false;
        setDraft(milestone.description ?? '');
        setEditing(true);
      }}
      className={clsx(
        'block w-full whitespace-pre-wrap break-words rounded-sm px-2 py-1 text-left text-base leading-6 transition-colors duration-100 hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary',
        milestone.description ? 'text-fg' : 'text-fg-subtlest',
      )}
    >
      <span id={descriptionId}>{milestone.description || m.project.descriptionPlaceholder}</span>
    </button>
  );
}

function MilestoneTarget({ milestone, patch }: { milestone: Milestone; patch: Patch }) {
  const [editing, setEditing] = useState(false);
  const dateId = useId();
  const label = `${m.project.targetDate}: ${milestone.name}`;
  if (editing) {
    return (
      <input
        autoFocus
        type="date"
        aria-label={label}
        value={milestone.targetDate ?? ''}
        onChange={(e) => void patch(milestone.id, { targetDate: e.target.value || null })}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur();
        }}
        className="h-7 w-32 rounded-sm border border-border-input bg-surface px-1 text-sm text-fg"
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-describedby={dateId}
      onClick={() => setEditing(true)}
      className={clsx(
        'h-7 shrink-0 rounded-sm px-1.5 text-sm text-fg-subtlest transition-colors duration-100 hover:bg-neutral-hover hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary',
        !milestone.targetDate && 'opacity-0 group-hover/milestone:opacity-100 group-focus-within/milestone:opacity-100 max-sm:opacity-100',
      )}
    >
      <span id={dateId}>{milestone.targetDate ? formatShortDate(milestone.targetDate) : m.project.setTargetDate}</span>
    </button>
  );
}

/** Editable document rows on the overview; the Milestones tab retains the planning timeline. */
export function ProjectOverviewMilestones({ projectId, milestones }: { projectId: string; milestones: Milestone[] }) {
  const actions = useMilestoneActions(projectId, milestones);
  const sorted = sortMilestones(milestones);
  const href = `/project/${projectId}/milestones`;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Milestone | null>(null);
  const finishDrag = () => {
    setDragId(null);
    setOverId(null);
  };
  return (
    <section aria-label={m.project.milestones} className="flex flex-col gap-3 pt-3" data-testid="overview-milestones">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-fg-subtle">{m.project.milestones}</h2>
        <Link to={href} className="rounded-sm px-1.5 py-0.5 text-sm text-fg-subtlest hover:bg-hover hover:text-fg">{m.project.viewAll}</Link>
      </div>
      {sorted.length === 0 ? <p className="text-base text-fg-subtlest">{m.project.noMilestones}</p> : (
        <ul className="-mx-2 flex flex-col gap-8">
          {sorted.map((milestone, index) => (
            <li
              key={milestone.id}
              data-testid="overview-milestone"
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverId(milestone.id);
              }}
              onDrop={(e) => {
                if (!dragId) return;
                e.preventDefault();
                if (dragId !== milestone.id) void actions.moveTo(dragId, index);
                finishDrag();
              }}
              className={clsx('group/milestone relative min-w-0 rounded-md', dragId === milestone.id && 'opacity-50', overId === milestone.id && dragId !== milestone.id && 'bg-primary-subtle')}
            >
              <div className="relative grid min-h-9 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1 rounded-md px-2 transition-colors duration-100 group-hover/milestone:bg-raised group-focus-within/milestone:bg-raised sm:flex sm:flex-wrap">
                <div className="absolute -left-7 top-1 hidden opacity-0 group-hover/milestone:opacity-100 group-focus-within/milestone:opacity-100 sm:block">
                <IconButton
                  label={`${m.project.dragToReorder}: ${milestone.name}`}
                  size="sm"
                  icon={<Icon name="drag-handle" className="h-3 w-3" />}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', milestone.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragId(milestone.id);
                  }}
                  onDragEnd={finishDrag}
                  className="cursor-grab"
                />
                </div>
                <div className="col-start-1 row-start-1 min-w-0 flex-1 basis-32">
                  <PopupSelect
                    label={`${m.project.status}: ${milestone.name}`}
                    value={milestone.status}
                    options={STATUSES.map((status) => ({ value: status, label: m.project.milestoneStatuses[status], icon: <MilestoneIcon status={status} /> }))}
                    searchable={false}
                    onChange={(status) => void actions.patch(milestone.id, { status: status as MilestoneStatus })}
                    renderTrigger={(trigger) => (
                      <button
                        ref={trigger.ref as Ref<HTMLButtonElement>}
                        type="button"
                        aria-label={`${m.project.status}: ${milestone.name}, ${m.project.milestoneStatuses[milestone.status]}`}
                        aria-haspopup="listbox"
                        aria-expanded={trigger.open}
                        onClick={trigger.onClick}
                        onKeyDown={trigger.onKeyDown}
                        className="flex h-9 max-w-full items-center gap-2 rounded-sm pr-2 text-left text-base font-semibold text-fg focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <MilestoneIcon status={milestone.status} percent={milestone.progress.percent} />
                        <span className="truncate">{milestone.name}</span>
                        <Icon name="chevron-down" className="h-3 w-3 shrink-0 text-fg-subtlest" />
                      </button>
                    )}
                  />
                </div>
                <div className="col-span-3 col-start-1 row-start-2 sm:contents"><MilestoneTarget milestone={milestone} patch={actions.patch} /></div>
                <Tooltip content={m.project.milestoneProgressSummary(Math.round(milestone.progress.percent), milestone.progress.done, milestone.progress.total)}>
                  <Link to={milestoneIssuesHref(projectId, milestone.id)} aria-label={m.project.viewMilestoneIssues(milestone.name)} className="col-start-2 row-start-1 shrink-0 rounded-full px-2 py-1 text-sm tabular-nums text-fg-subtle group-hover/milestone:bg-neutral group-focus-within/milestone:bg-neutral">
                    {m.project.issueCount(milestone.progress.total)} · {Math.round(milestone.progress.percent)}%
                  </Link>
                </Tooltip>
                <div className="col-start-3 row-start-1 opacity-0 group-hover/milestone:opacity-100 group-focus-within/milestone:opacity-100 max-sm:opacity-100">
                  <DropdownMenu aria-label={m.project.milestoneActions(milestone.name)} placement="bottom-end" trigger={<IconButton label={m.project.milestoneActions(milestone.name)} size="sm" icon={<Icon name="more" />} />}>
                    <MenuItem icon={<Icon name="arrow-up" />} disabled={index === 0} onSelect={() => void actions.moveTo(milestone.id, index - 1)}>{m.project.moveUp}</MenuItem>
                    <MenuItem icon={<Icon name="arrow-down" />} disabled={index === sorted.length - 1} onSelect={() => void actions.moveTo(milestone.id, index + 1)}>{m.project.moveDown}</MenuItem>
                    <MenuItem icon={<Icon name="trash" />} danger onSelect={() => setToDelete(milestone)}>{m.common.delete}</MenuItem>
                  </DropdownMenu>
                </div>
              </div>
              <div className="ml-2 pt-1"><MilestoneDescription milestone={milestone} patch={actions.patch} /></div>
            </li>
          ))}
        </ul>
      )}
      <Link to={href} className="-mx-2 flex h-8 items-center gap-2 rounded-sm px-2 text-base text-fg-subtlest hover:bg-hover hover:text-fg"><Icon name="add" className="h-3.5 w-3.5" />{m.project.addMilestone}</Link>
      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) void actions.remove(toDelete.id);
          setToDelete(null);
        }}
        title={m.project.deleteMilestoneConfirm}
        description={toDelete ? m.project.deleteMilestoneBody(toDelete.name) : ''}
        confirmLabel={m.common.delete}
        destructive
      />
    </section>
  );
}
