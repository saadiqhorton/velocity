import { useState } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Avatar, Icon, IconButton, PopupSelect, PriorityIcon, StatusIcon } from '@velocity/ui';
import type { PopupOption, PopupSelectTriggerProps } from '@velocity/ui';
import type { FilterChip } from '@velocity/graphql/dsl';
import type { FilterField } from '@velocity/schema/filter-ast';
import { useWorkspace } from '@/app/workspace';
import type { WorkspaceData } from '@/app/workspace';
import {
  CHIP_FIELDS,
  DATE_FIELDS,
  DATE_PRESETS,
  chipIsNegative,
  chipValues,
  flipChip,
  makeDateChip,
  makeSetChip,
  makeTextChip,
  withValues,
} from '@/lib/chips';
import type { ChipField } from '@/lib/chips';
import { ColorDot, ProjectIcon, TeamIcon } from '@/components/common/EntityIcons';
import { PRIORITY_KEYS } from '@/components/issues/IssueRow';
import { m } from '@/i18n';

const FIELD_ICON: Record<ChipField, ReactNode> = {
  status: <Icon name="success" />,
  statusCategory: <Icon name="success" />,
  assignee: <Icon name="user" />,
  creator: <Icon name="user" />,
  priority: <Icon name="priority-high" />,
  label: <Icon name="label" />,
  project: <Icon name="project" />,
  cycle: <Icon name="cycle" />,
  team: <Icon name="team" />,
  estimate: <Icon name="chart" />,
  createdAt: <Icon name="calendar" />,
  updatedAt: <Icon name="calendar" />,
  completedAt: <Icon name="calendar" />,
  title: <Icon name="search" />,
};

export function fieldLabel(field: FilterField): string {
  const labels: Partial<Record<FilterField, string>> = {
    status: m.issue.status,
    statusCategory: m.view.fields.statusCategory,
    assignee: m.issue.assignee,
    creator: m.view.fields.creator,
    priority: m.issue.priority,
    label: m.issue.labels,
    project: m.issue.project,
    cycle: m.issue.cycle,
    team: m.issue.team,
    estimate: m.issue.estimate,
    createdAt: m.view.fields.createdAt,
    updatedAt: m.view.fields.updatedAt,
    completedAt: m.view.fields.completedAt,
    title: m.view.fields.title,
  };
  return labels[field] ?? field;
}

function datePresetLabel(raw: string): string {
  const match = /^-(\d+)([dwmy])$/.exec(raw);
  if (!match) return raw;
  const unit = ({ d: 'day', w: 'week', m: 'month', y: 'year' } as const)[match[2] as 'd' | 'w' | 'm' | 'y'];
  return m.view.ago(Number(match[1]), unit);
}

/** Options for a field's value picker. Values are DSL-ready strings. */
export function fieldOptions(field: FilterField, ws: WorkspaceData, teamId?: string): PopupOption[] {
  switch (field) {
    case 'status': {
      const teams = teamId ? ws.teams.filter((t) => t.id === teamId) : ws.teams;
      const seen = new Map<string, PopupOption>();
      for (const t of teams) {
        for (const s of t.statuses) {
          const key = s.name.toLowerCase();
          if (!seen.has(key)) {
            seen.set(key, { value: s.name, label: s.name, icon: <StatusIcon category={s.category} color={s.color} label="" /> });
          }
        }
      }
      return [...seen.values()];
    }
    case 'statusCategory':
      return (['backlog', 'todo', 'in_progress', 'done', 'canceled'] as const).map((c) => ({
        value: c,
        label: m.statusCategory[c],
        icon: <StatusIcon category={c} label="" />,
      }));
    case 'assignee':
    case 'creator':
      return [
        { value: 'me', label: m.view.me, icon: <Avatar name={ws.viewer.name} src={ws.viewer.avatarUrl} size={16} /> },
        ...(field === 'assignee' ? [{ value: 'empty', label: m.issue.noAssignee, icon: <Icon name="user" className="text-fg-subtlest" /> }] : []),
        ...ws.activeUsers
          .filter((u) => u.id !== ws.viewer.id)
          .map((u) => ({ value: u.username, label: u.name, keywords: [u.username], icon: <Avatar name={u.name} src={u.avatarUrl} size={16} /> })),
      ];
    case 'priority':
      return [0, 1, 2, 3, 4].map((p) => ({
        value: String(p),
        label: m.priority[p as 0 | 1 | 2 | 3 | 4],
        icon: <PriorityIcon priority={PRIORITY_KEYS[p] ?? 'none'} />,
      }));
    case 'label':
      return [
        { value: 'empty', label: m.issue.noLabels, icon: <Icon name="label" className="text-fg-subtlest" /> },
        ...ws.labels.filter((l) => !l.isGroup).map((l) => ({ value: l.name, label: l.name, icon: <ColorDot color={l.color} size={8} /> })),
      ];
    case 'project':
      return [
        { value: 'empty', label: m.issue.noProject, icon: <Icon name="project" className="text-fg-subtlest" /> },
        ...ws.projects.map((p) => ({ value: p.name, label: p.name, icon: <ProjectIcon project={p} /> })),
      ];
    case 'cycle':
      return [
        { value: 'current', label: m.view.cycleCurrent, icon: <Icon name="cycle" /> },
        { value: 'next', label: m.view.cycleNext, icon: <Icon name="cycle" /> },
        { value: 'previous', label: m.view.cyclePrevious, icon: <Icon name="cycle" /> },
        { value: 'empty', label: m.issue.noCycle, icon: <Icon name="cycle" className="text-fg-subtlest" /> },
      ];
    case 'team':
      return ws.teams.map((t) => ({ value: t.key, label: t.name, keywords: [t.key], icon: <TeamIcon team={t} /> }));
    case 'estimate':
      return [
        { value: 'empty', label: m.issue.noEstimate },
        ...[0, 1, 2, 3, 5, 8, 13].map((n) => ({ value: String(n), label: m.issue.estimatePoints(n) })),
      ];
    case 'createdAt':
    case 'updatedAt':
    case 'completedAt':
      return DATE_PRESETS.map((p) => ({ value: p, label: datePresetLabel(p), icon: <Icon name="calendar" /> }));
    default:
      return [];
  }
}

function valueLabel(field: FilterField, raw: string, ws: WorkspaceData): string {
  if (raw === 'me') return m.view.me;
  if (raw === 'empty') return m.view.empty;
  if (field === 'priority') return m.priority[Number(raw) as 0 | 1 | 2 | 3 | 4] ?? raw;
  if (field === 'statusCategory') return m.statusCategory[raw as 'todo'] ?? raw;
  if (field === 'assignee' || field === 'creator') return ws.users.find((u) => u.username === raw)?.name ?? raw;
  if (field === 'team') return ws.teamsByKey.get(raw.toUpperCase())?.name ?? raw;
  if (DATE_FIELDS.has(field)) return datePresetLabel(raw);
  return raw;
}

function opLabel(chip: FilterChip, count: number): string {
  if (DATE_FIELDS.has(chip.field)) return chip.op === 'lt' || chip.op === 'lte' ? m.view.before : m.view.after;
  if (chip.op === 'contains') return m.view.contains;
  const neg = chipIsNegative(chip);
  if (count > 1) return neg ? m.view.isNoneOf : m.view.isAnyOf;
  return neg ? m.view.isNot : m.view.is;
}

interface ValuePickerProps {
  label: string;
  options: PopupOption[];
  multiple: boolean;
  values: string[];
  onChange: (values: string[]) => void;
  trigger?: (t: PopupSelectTriggerProps) => ReactNode;
  /** Anchored mode (no trigger): opens immediately and calls onClose when dismissed. */
  anchorEl?: HTMLElement | null;
  onClose?: () => void;
  onCreate?: (query: string) => void;
}

/** PopupSelect in single or multi mode with an array-valued API. */
function ValuePicker({ label, options, multiple, values, onChange, trigger, anchorEl, onClose, onCreate }: ValuePickerProps) {
  const anchored = anchorEl !== undefined
    ? { anchorEl, open: true, onOpenChange: (open: boolean) => (open ? undefined : onClose?.()) }
    : { renderTrigger: trigger };
  const create = onCreate ? { onCreate, createLabel: (q: string) => `${m.view.contains} “${q}”` } : {};
  if (multiple) {
    return <PopupSelect label={label} options={options} multiple value={values} onChange={onChange} {...anchored} {...create} />;
  }
  return <PopupSelect label={label} options={options} value={values[0] ?? null} onChange={(v: string) => onChange([v])} {...anchored} {...create} />;
}

interface ChipProps {
  chip: FilterChip;
  teamId?: string;
  onChange: (chip: FilterChip | null) => void;
}

function Chip({ chip, teamId, onChange }: ChipProps) {
  const ws = useWorkspace();
  const values = chipValues(chip);
  const options = fieldOptions(chip.field, ws, teamId);
  const isDate = DATE_FIELDS.has(chip.field);
  const isText = chip.op === 'contains';
  const label = values.length > 2 ? m.view.countOf(values.length, fieldLabel(chip.field).toLowerCase()) : values.map((v) => valueLabel(chip.field, v, ws)).join(', ');
  const segment = 'flex h-full items-center px-1.5 transition-colors duration-100 hover:bg-hover';
  return (
    <span
      className="inline-flex h-7 shrink-0 items-stretch overflow-hidden rounded-sm border border-border bg-surface text-sm text-fg"
      data-testid="filter-chip"
    >
      <span className="flex items-center gap-1 pl-2 pr-1 text-fg-subtle">
        {FIELD_ICON[chip.field as ChipField]}
        {fieldLabel(chip.field)}
      </span>
      <button type="button" className={clsx(segment, 'text-fg-subtle')} onClick={() => onChange(flipChip(chip))} disabled={isText}>
        {opLabel(chip, values.length)}
      </button>
      {isText ? (
        <span className={segment}>“{values[0]}”</span>
      ) : (
        <ValuePicker
          label={fieldLabel(chip.field)}
          options={options}
          multiple={!isDate}
          values={isDate ? [] : values}
          onChange={(next) => {
            if (isDate) {
              const v = next[0];
              if (v) onChange(makeDateChip(chip.field, v, chip.op === 'lt' ? 'before' : 'after'));
            } else onChange(next.length ? withValues(chip, next) : null);
          }}
          trigger={(t) => (
            <button
              type="button"
              ref={t.ref as never}
              onClick={t.onClick}
              onKeyDown={t.onKeyDown}
              aria-haspopup="listbox"
              aria-expanded={t.open}
              className={clsx(segment, 'max-w-48 font-medium')}
            >
              <span className="truncate">{label}</span>
            </button>
          )}
        />
      )}
      <button
        type="button"
        aria-label={m.view.removeFilter(fieldLabel(chip.field))}
        className={clsx(segment, 'border-l border-border text-fg-subtle')}
        onClick={() => onChange(null)}
      >
        <Icon name="close" className="h-3 w-3" />
      </button>
    </span>
  );
}

export interface FilterBarProps {
  /** null = the filter cannot be shown as chips (OR / nested groups). */
  chips: FilterChip[] | null;
  onChange: (chips: FilterChip[]) => void;
  /** Restrict status options to one team. */
  teamId?: string;
  /** Fields not offered (e.g. team on a team screen). */
  hiddenFields?: FilterField[];
}

/** Filter chips + "+ Filter" (SPEC §4.11.6). No raw DSL text is shown. */
export function FilterBar({ chips, onChange, teamId, hiddenFields = [] }: FilterBarProps) {
  const ws = useWorkspace();
  const [adding, setAdding] = useState<FilterField | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [fieldOpen, setFieldOpen] = useState(false);

  const fieldChoices: PopupOption[] = CHIP_FIELDS.filter((f) => !hiddenFields.includes(f)).map((f) => ({
    value: f,
    label: fieldLabel(f),
    icon: FIELD_ICON[f],
  }));

  if (chips === null) {
    return (
      <span className="flex items-center gap-1 text-sm text-fg-subtle" title={m.view.unsupportedFilter}>
        <Icon name="filter" />
        {m.view.unsupportedFilter}
        <button type="button" className="ml-1 text-link hover:underline" onClick={() => onChange([])}>
          {m.list.clearFilters}
        </button>
      </span>
    );
  }

  const replaceAt = (i: number, next: FilterChip | null) => {
    const copy = [...chips];
    if (next) copy[i] = next;
    else copy.splice(i, 1);
    onChange(copy);
  };

  const addingOptions = adding ? fieldOptions(adding, ws, teamId) : [];
  const existingIndex = adding ? chips.findIndex((c) => c.field === adding && !chipIsNegative(c) && c.op !== 'contains') : -1;
  const existingValues = existingIndex >= 0 ? chipValues(chips[existingIndex]!) : [];

  return (
    <div className="flex min-w-0 items-center gap-1" data-testid="filter-bar">
      {chips.map((chip, i) => (
        <Chip key={`${chip.field}-${i}`} chip={chip} teamId={teamId} onChange={(c) => replaceAt(i, c)} />
      ))}
      <PopupSelect
        label={m.view.filterField}
        options={fieldChoices}
        open={fieldOpen}
        onOpenChange={setFieldOpen}
        onChange={(f: string) => {
          setAdding(f as FilterField);
        }}
        renderTrigger={(t) => (
          <button
            type="button"
            ref={(el) => {
              (t.ref as (el: HTMLElement | null) => void)(el);
              setAnchor(el);
            }}
            onClick={t.onClick}
            onKeyDown={t.onKeyDown}
            aria-haspopup="listbox"
            aria-expanded={t.open}
            data-testid="add-filter"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-sm text-fg-subtle transition-colors duration-100 hover:bg-hover hover:text-fg"
          >
            <Icon name="filter" />
            {chips.length === 0 ? m.view.addFilter : null}
          </button>
        )}
      />
      {adding ? (
        <ValuePicker
          label={fieldLabel(adding)}
          options={addingOptions}
          anchorEl={anchor}
          multiple={!DATE_FIELDS.has(adding) && adding !== 'title'}
          values={!DATE_FIELDS.has(adding) && adding !== 'title' ? existingValues : []}
          onClose={() => setAdding(null)}
          onCreate={adding === 'title' ? (q) => onChange([...chips, makeTextChip('title', q)]) : undefined}
          onChange={(next) => {
            if (DATE_FIELDS.has(adding)) {
              const v = next[0];
              if (v) onChange([...chips, makeDateChip(adding, v, 'after')]);
              setAdding(null);
              return;
            }
            const chip = makeSetChip(adding, next);
            if (existingIndex >= 0) replaceAt(existingIndex, chip);
            else if (chip) onChange([...chips, chip]);
          }}
        />
      ) : null}
    </div>
  );
}

export function ClearFiltersButton({ onClick }: { onClick: () => void }) {
  return <IconButton label={m.list.clearFilters} size="sm" icon={<Icon name="close" />} onClick={onClick} />;
}
