import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button, ConfirmDialog, DropdownMenu, EmptyState, Icon, IconButton, MenuItem, ProgressBar, Select, TextField } from '@velocity/ui';
import {
  CreateMilestoneDocument,
  DeleteMilestoneDocument,
  ReorderMilestoneDocument,
  UpdateMilestoneDocument,
} from '@/gql/graphql';
import type { MilestoneFieldsFragment, MilestoneInput, MilestoneStatus } from '@/gql/graphql';
import { useElementWidth } from '@/components/charts/useElementWidth';
import { useOptimisticMutation } from '@/lib/mutation';
import { formatShortDate } from '@/lib/format';
import { m } from '@/i18n';

export type Milestone = MilestoneFieldsFragment;

const MILESTONE_STATUSES: MilestoneStatus[] = ['planned', 'in_progress', 'done'];
const STATUS_TOKEN: Record<string, string> = { planned: 'var(--ds-status-grey)', in_progress: 'var(--ds-status-blue)', done: 'var(--ds-status-green)' };
const DAY = 86_400_000;
const statusLabel = (s: string): string => (m.project.milestoneStatuses as Record<string, string>)[s] ?? s;
const parseDay = (d: string): number => new Date(`${d}T00:00:00`).getTime();
const startOfToday = (): number => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const ORDER_STEP = 1000;
function orderBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return ORDER_STEP;
  if (before === null) return (after ?? 0) - ORDER_STEP;
  if (after === null) return before + ORDER_STEP;
  return before + (after - before) / 2;
}

export function sortMilestones(list: readonly Milestone[]): Milestone[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function useMilestoneActions(projectId: string, milestones: readonly Milestone[]) {
  const byId = useMemo(() => new Map(milestones.map((x) => [x.id, x])), [milestones]);
  const [create, { loading: creating }] = useOptimisticMutation(CreateMilestoneDocument, {
    optimistic: { serverConfirmed: 'The server mints the milestone id and sort order' },
    rollback: () => m.project.rollback.milestone,
    refetchQueries: ['ProjectDetail'],
  });
  const [update] = useOptimisticMutation(UpdateMilestoneDocument, {
    optimistic: (vars) => {
      const cur = byId.get(vars.id);
      if (!cur) throw new Error('milestone not cached');
      const i = vars.input;
      return {
        __typename: 'Mutation' as const,
        updateMilestone: {
          ...cur,
          name: i.name ?? cur.name,
          description: i.description === undefined ? cur.description : i.description,
          status: i.status ?? cur.status,
          targetDate: i.targetDate === undefined ? cur.targetDate : i.targetDate,
        },
      };
    },
    rollback: () => m.project.rollback.milestone,
  });
  const [remove] = useOptimisticMutation(DeleteMilestoneDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, deleteMilestone: true }),
    rollback: () => m.project.rollback.milestone,
    update: (cache, _res, vars) => {
      cache.evict({ id: cache.identify({ __typename: 'Milestone', id: vars.id }) });
      cache.gc();
    },
    refetchQueries: ['ProjectDetail'],
  });
  const [reorder] = useOptimisticMutation(ReorderMilestoneDocument, {
    optimistic: (vars) => {
      const before = vars.beforeId ? (byId.get(vars.beforeId)?.sortOrder ?? null) : null;
      const after = vars.afterId ? (byId.get(vars.afterId)?.sortOrder ?? null) : null;
      return { __typename: 'Mutation' as const, reorderMilestone: { __typename: 'Milestone' as const, id: vars.id, sortOrder: orderBetween(before, after) } };
    },
    rollback: () => m.flags.rollback.reorder,
  });
  const sorted = useMemo(() => sortMilestones(milestones), [milestones]);
  return {
    creating,
    add: (name: string) => create({ projectId, input: { name } }),
    patch: (id: string, input: MilestoneInput) => update({ id, input }),
    remove: (id: string) => remove({ id }),
    /** Move `id` so that it sits at `index` in the list without itself. */
    moveTo: (id: string, index: number) => {
      const rest = sorted.filter((x) => x.id !== id);
      const i = Math.max(0, Math.min(rest.length, index));
      return reorder({ id, beforeId: rest[i - 1]?.id ?? null, afterId: rest[i]?.id ?? null });
    },
  };
}

/** Horizontal timeline: milestones placed by target date between the earliest date and the latest, with a today marker. */
function Timeline({ milestones }: { milestones: Milestone[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>(640);
  const dated = milestones.filter((x) => x.targetDate).sort((a, b) => parseDay(a.targetDate ?? '') - parseDay(b.targetDate ?? ''));
  const undated = milestones.length - dated.length;
  const today = startOfToday();
  if (dated.length === 0) {
    return (
      <div className="rounded-md border border-border bg-sunken px-4 py-6 text-center text-base text-fg-subtle" data-testid="timeline-empty">
        {m.project.timelineEmpty}
      </div>
    );
  }
  const times = dated.map((x) => parseDay(x.targetDate ?? ''));
  let start = Math.min(today, ...times) - 14 * DAY;
  let end = Math.max(today, ...times) + 14 * DAY;
  if (end - start < 60 * DAY) {
    const pad = (60 * DAY - (end - start)) / 2;
    start -= pad;
    end += pad;
  }
  const pct = (t: number) => ((t - start) / (end - start)) * 100;
  const ticks: { t: number; label: string }[] = [];
  const first = new Date(start);
  const cursor = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  const monthStep = width < 360 ? 2 : 1;
  let k = 0;
  while (cursor.getTime() < end) {
    if (k % monthStep === 0) ticks.push({ t: cursor.getTime(), label: cursor.toLocaleDateString(undefined, { month: 'short', year: cursor.getMonth() === 0 ? 'numeric' : undefined }) });
    cursor.setMonth(cursor.getMonth() + 1);
    k += 1;
  }
  const todayPct = pct(today);

  return (
    <div className="rounded-md border border-border bg-raised" data-testid="milestone-timeline">
      <div ref={ref} className="relative px-4 pb-2 pt-2">
        <div className="relative h-6 border-b border-border text-xs text-fg-subtlest" aria-hidden="true">
          {ticks.map((tk) => (
            <span key={tk.t} className="absolute top-1" style={{ left: `${pct(tk.t)}%` }}>
              <span className="absolute -left-px top-4 h-2 border-l border-border" />
              <span className="-translate-x-1/2 whitespace-nowrap">{tk.label}</span>
            </span>
          ))}
        </div>
        <div className="relative">
        <ul aria-label={m.project.timeline}>
          {dated.map((x) => {
            const p = pct(parseDay(x.targetDate ?? ''));
            const flip = p > 62;
            return (
              <li
                key={x.id}
                className="relative h-10"
                aria-label={`${x.name}, ${formatShortDate(x.targetDate)}, ${statusLabel(x.status)}, ${Math.round(x.progress.percent)}%`}
              >
                <span aria-hidden="true" className="absolute left-0 right-0 top-1/2 border-t border-border" />
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-sm border-2 border-surface"
                  style={{ left: `${p}%`, backgroundColor: STATUS_TOKEN[x.status] }}
                />
                <span
                  className={clsx('absolute top-1/2 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap text-base', flip ? 'flex-row-reverse' : '')}
                  style={flip ? { right: `${100 - p}%`, paddingRight: 12 } : { left: `${p}%`, paddingLeft: 12 }}
                >
                  <span className="max-w-40 truncate font-medium text-fg">{x.name}</span>
                  <span className="text-sm text-fg-subtle">{formatShortDate(x.targetDate)}</span>
                  <span className="w-12 shrink-0">
                    <ProgressBar value={x.progress.percent} label={`${m.project.progress}: ${x.name}`} />
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 top-0 border-l border-dashed"
            style={{ left: `${todayPct}%`, borderColor: 'var(--ds-status-red)' }}
          />
        </div>
        <div className="relative h-5 text-xs" aria-hidden="true">
          <span className="absolute top-0.5 -translate-x-1/2 whitespace-nowrap font-medium" style={{ left: `${todayPct}%`, color: 'var(--ds-status-red-text)' }}>
            {m.project.today}
          </span>
        </div>
      </div>
      {undated > 0 ? <p className="border-t border-border px-4 py-2 text-sm text-fg-subtle">{m.project.undatedNote(undated)}</p> : null}
    </div>
  );
}

function NameCell({ milestone, onRename }: { milestone: Milestone; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(milestone.name);
  const commit = () => {
    setEditing(false);
    const next = value.trim();
    if (next && next !== milestone.name) onRename(next);
    else setValue(milestone.name);
  };
  if (editing) {
    return (
      <input
        autoFocus
        aria-label={m.project.milestoneName}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setValue(milestone.name);
            setEditing(false);
          }
        }}
        className="h-7 w-full rounded-sm border border-border-input bg-surface px-2 text-base text-fg"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setValue(milestone.name);
        setEditing(true);
      }}
      title={m.common.rename}
      className="h-7 max-w-full truncate rounded-sm px-2 text-left text-base font-medium text-fg hover:bg-hover"
    >
      {milestone.name}
    </button>
  );
}

export function ProjectMilestones({ projectId, milestones }: { projectId: string; milestones: Milestone[] }) {
  const actions = useMilestoneActions(projectId, milestones);
  const sorted = useMemo(() => sortMilestones(milestones), [milestones]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Milestone | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    await actions.add(name);
    addRef.current?.focus();
  };

  return (
    <div className="mx-auto flex max-w-240 flex-col gap-6 p-5" data-testid="project-milestones">
      <section aria-label={m.project.timeline} className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-fg">{m.project.timeline}</h2>
        <Timeline milestones={sorted} />
      </section>
      <section aria-label={m.project.milestones} className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">{m.project.milestones}</h2>
          <Button size="sm" iconBefore={<Icon name="add" />} onClick={() => setAdding(true)} data-testid="add-milestone">
            {m.project.addMilestone}
          </Button>
        </div>
        {sorted.length === 0 && !adding ? (
          <EmptyState icon="list" message={m.project.noMilestones} action={<Button onClick={() => setAdding(true)}>{m.project.addMilestone}</Button>} />
        ) : (
          <ul className="rounded-md border border-border bg-raised" data-testid="milestone-list">
            {sorted.map((x, i) => (
              <li
                key={x.id}
                draggable
                onDragStart={(e) => {
                  setDragId(x.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (dragId) {
                    e.preventDefault();
                    setOverId(x.id);
                  }
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== x.id) void actions.moveTo(dragId, i);
                  setDragId(null);
                  setOverId(null);
                }}
                data-testid="milestone-row"
                className={clsx(
                  'flex min-h-11 items-center gap-2 border-b border-border px-2 py-1 last:border-b-0',
                  dragId === x.id && 'opacity-50',
                  overId === x.id && dragId !== x.id && 'bg-primary-subtle',
                )}
              >
                <span className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center text-fg-subtlest" aria-hidden="true" title={m.project.dragToReorder}>
                  <Icon name="drag-handle" />
                </span>
                <div className="min-w-0 flex-1">
                  <NameCell milestone={x} onRename={(name) => void actions.patch(x.id, { name })} />
                </div>
                <div className="w-28 shrink-0">
                  <Select
                    size="sm"
                    aria-label={`${m.project.status}: ${x.name}`}
                    value={x.status}
                    onChange={(e) => void actions.patch(x.id, { status: e.target.value as MilestoneStatus })}
                    options={MILESTONE_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
                  />
                </div>
                <div className="w-36 shrink-0">
                  <TextField
                    size="sm"
                    type="date"
                    aria-label={`${m.project.targetDate}: ${x.name}`}
                    value={x.targetDate ?? ''}
                    onChange={(e) => void actions.patch(x.id, { targetDate: e.target.value || null })}
                  />
                </div>
                <div className="hidden w-28 shrink-0 items-center gap-2 sm:flex" title={m.cycles.stats(x.progress.done, x.progress.total)}>
                  <ProgressBar value={x.progress.percent} label={`${m.project.progress}: ${x.name}`} className="flex-1" />
                  <span className="w-8 shrink-0 text-right text-sm tabular-nums text-fg-subtle">{Math.round(x.progress.percent)}%</span>
                </div>
                <DropdownMenu
                  aria-label={m.project.milestoneActions(x.name)}
                  placement="bottom-end"
                  trigger={<IconButton label={m.project.milestoneActions(x.name)} size="sm" icon={<Icon name="more" />} />}
                >
                  <MenuItem icon={<Icon name="arrow-up" />} disabled={i === 0} onSelect={() => void actions.moveTo(x.id, i - 1)}>
                    {m.project.moveUp}
                  </MenuItem>
                  <MenuItem icon={<Icon name="arrow-down" />} disabled={i === sorted.length - 1} onSelect={() => void actions.moveTo(x.id, i + 1)}>
                    {m.project.moveDown}
                  </MenuItem>
                  <MenuItem icon={<Icon name="trash" />} danger onSelect={() => setToDelete(x)}>
                    {m.common.delete}
                  </MenuItem>
                </DropdownMenu>
              </li>
            ))}
            {adding ? (
              <li className="flex items-center gap-2 px-2 py-2">
                <span className="w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <TextField
                    ref={addRef}
                    size="sm"
                    autoFocus
                    aria-label={m.project.milestoneName}
                    placeholder={m.project.milestoneName}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitNew();
                      if (e.key === 'Escape') {
                        setAdding(false);
                        setNewName('');
                      }
                    }}
                    data-testid="new-milestone-name"
                  />
                </div>
                <Button size="sm" variant="primary" loading={actions.creating} disabled={!newName.trim()} onClick={() => void submitNew()}>
                  {m.common.create}
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => {
                    setAdding(false);
                    setNewName('');
                  }}
                >
                  {m.common.cancel}
                </Button>
              </li>
            ) : null}
          </ul>
        )}
      </section>
      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) void actions.remove(toDelete.id);
          setToDelete(null);
        }}
        title={m.project.deleteMilestoneConfirm}
        description={m.project.deleteMilestoneBody(toDelete?.name ?? '')}
        confirmLabel={m.common.delete}
        destructive
      />
    </div>
  );
}
