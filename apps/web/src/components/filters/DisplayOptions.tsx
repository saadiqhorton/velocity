import { useState } from 'react';
import clsx from 'clsx';
import { Button, Icon, Popover, Select, Switch } from '@velocity/ui';
import type { GroupBy, Ordering } from '@/lib/grouping';
import { COLUMN_KEYS } from '@/lib/viewState';
import type { ColumnKey, DisplayState, Layout, ShowCompleted } from '@/lib/viewState';
import { m } from '@/i18n';

const GROUPINGS: GroupBy[] = ['status', 'assignee', 'priority', 'label', 'project', 'cycle', 'team', 'none'];
const ORDERINGS: Ordering[] = ['priority', 'status', 'created', 'updated', 'estimate', 'manual'];

const COLUMN_LABEL: Record<ColumnKey, () => string> = {
  priority: () => m.issue.priority,
  identifier: () => 'ID',
  status: () => m.issue.status,
  labels: () => m.issue.labels,
  project: () => m.issue.project,
  cycle: () => m.issue.cycle,
  estimate: () => m.issue.estimate,
  assignee: () => m.issue.assignee,
  created: () => m.view.fields.createdAt,
  updated: () => m.view.fields.updatedAt,
};

export interface DisplayOptionsProps {
  display: DisplayState;
  onChange: (next: DisplayState) => void;
  /** Hide groupings that make no sense on this screen (e.g. team on a team view). */
  hiddenGroupings?: GroupBy[];
  /** Board is only offered when the grouping has columns. */
  allowBoard?: boolean;
  dirty?: boolean;
  onReset?: () => void;
}

/** Display options (SPEC §3.10, §4.11.6): grouping, ordering, layout, properties. */
export function DisplayOptions({ display, onChange, hiddenGroupings = [], allowBoard = true, dirty, onReset }: DisplayOptionsProps) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const set = <K extends keyof DisplayState>(key: K, value: DisplayState[K]) => onChange({ ...display, [key]: value });
  const toggleColumn = (c: ColumnKey) =>
    set('columns', display.columns.includes(c) ? display.columns.filter((x) => x !== c) : COLUMN_KEYS.filter((k) => k === c || display.columns.includes(k)));

  return (
    <>
      <Button
        ref={setAnchor}
        size="sm"
        variant="subtle"
        aria-haspopup="dialog"
        aria-expanded={open}
        iconBefore={<Icon name="display" />}
        onClick={() => setOpen(!open)}
        data-testid="display-options"
        className={clsx(dirty && 'text-fg-selected')}
      >
        {m.view.display}
      </Button>
      <Popover
        anchorEl={anchor}
        open={open}
        onDismiss={() => setOpen(false)}
        placement="bottom-end"
        role="dialog"
        aria-label={m.view.display}
        className="w-80 p-3"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
            anchor?.focus();
          }
        }}
      >
        <div className="flex flex-col gap-3 text-base">
          <div className="grid grid-cols-2 gap-1 rounded-sm bg-sunken p-0.5" role="radiogroup" aria-label={m.view.layout}>
            {(['list', 'board'] as Layout[]).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={display.layout === l}
                disabled={l === 'board' && !allowBoard}
                onClick={() => set('layout', l)}
                className={clsx(
                  'flex h-7 items-center justify-center gap-1 rounded-sm border text-sm transition-colors duration-100 disabled:text-fg-disabled',
                  display.layout === l ? 'border-border bg-raised font-medium text-fg' : 'border-transparent text-fg-subtle hover:text-fg',
                )}
              >
                <Icon name={l === 'list' ? 'list' : 'board'} />
                {l === 'list' ? m.list.list : m.list.board}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-fg-subtle">{m.view.grouping}</span>
            <span className="w-40">
              <Select
                size="sm"
                aria-label={m.view.grouping}
                value={display.grouping}
                onChange={(e) => set('grouping', e.target.value as GroupBy)}
                options={GROUPINGS.filter((g) => !hiddenGroupings.includes(g)).map((g) => ({ value: g, label: m.view.groupBy[g] }))}
              />
            </span>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-fg-subtle">{m.view.ordering}</span>
            <span className="w-40">
              <Select
                size="sm"
                aria-label={m.view.ordering}
                value={display.ordering}
                onChange={(e) => set('ordering', e.target.value as Ordering)}
                options={ORDERINGS.map((o) => ({ value: o, label: m.view.orderBy[o] }))}
              />
            </span>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-fg-subtle">{m.view.showCompleted}</span>
            <span className="w-40">
              <Select
                size="sm"
                aria-label={m.view.showCompleted}
                value={display.showCompleted}
                onChange={(e) => set('showCompleted', e.target.value as ShowCompleted)}
                options={[
                  { value: 'all', label: m.view.showCompletedAll },
                  { value: 'week', label: m.view.showCompletedWeek },
                  { value: 'none', label: m.view.showCompletedNone },
                ]}
              />
            </span>
          </label>
          <div className="flex items-center justify-between">
            <span className="text-fg-subtle">{m.view.showSubIssues}</span>
            <Switch aria-label={m.view.showSubIssues} checked={display.showSubIssues} onChange={(v) => set('showSubIssues', v)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-fg-subtle">{m.view.showEmptyGroups}</span>
            <Switch aria-label={m.view.showEmptyGroups} checked={display.showEmptyGroups} onChange={(v) => set('showEmptyGroups', v)} />
          </div>
          <div className="border-t border-border pt-3">
            <div className="mb-2 text-sm font-medium text-fg-subtle">{m.view.columns}</div>
            <div className="flex flex-wrap gap-1">
              {COLUMN_KEYS.map((c) => {
                const on = display.columns.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleColumn(c)}
                    className={clsx(
                      'h-6 rounded-sm border px-2 text-sm transition-colors duration-100',
                      on ? 'border-primary bg-primary-subtle text-fg-selected' : 'border-border text-fg-subtle hover:bg-hover',
                    )}
                  >
                    {COLUMN_LABEL[c]()}
                  </button>
                );
              })}
            </div>
          </div>
          {dirty && onReset ? (
            <div className="flex justify-end border-t border-border pt-3">
              <Button size="sm" variant="subtle" onClick={onReset}>
                {m.view.resetChanges}
              </Button>
            </div>
          ) : null}
        </div>
      </Popover>
    </>
  );
}
