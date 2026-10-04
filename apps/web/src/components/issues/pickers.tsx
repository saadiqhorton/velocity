import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import { Avatar, Icon, PriorityIcon, StatusIcon } from '@velocity/ui';
import type { PopupOption } from '@velocity/ui';
import type { EstimateScale, TeamFieldsFragment } from '@/gql/graphql';
import type { WorkspaceData } from '@/app/workspace';
import { CATEGORY_RANK } from '@/lib/grouping';
import { ColorDot, ProjectIcon, TeamIcon } from '@/components/common/EntityIcons';
import { PRIORITY_KEYS } from './IssueRow';
import { m } from '@/i18n';

export const NONE = '__none__';

export function statusOptions(team: Pick<TeamFieldsFragment, 'statuses'>): PopupOption[] {
  return [...team.statuses]
    .sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || a.order - b.order)
    .map((s) => ({ value: s.id, label: s.name, icon: <StatusIcon category={s.category} color={s.color} label="" /> }));
}

/** Linear-parity order: No priority first, then Urgent → Low. */
export const PRIORITY_ORDER = [4, 0, 1, 2, 3] as const;

export function priorityOptions(): PopupOption[] {
  return PRIORITY_ORDER.map((p, i) => ({
    value: String(p),
    label: m.priority[p],
    icon: <PriorityIcon priority={PRIORITY_KEYS[p] ?? 'none'} />,
    keywords: [String(i)],
  }));
}

export function assigneeOptions(ws: WorkspaceData): PopupOption[] {
  const me = ws.viewer;
  return [
    { value: NONE, label: m.issue.noAssignee, icon: <Icon name="user" className="text-fg-subtlest" /> },
    { value: me.id, label: me.name, description: m.common.you, icon: <Avatar name={me.name} src={me.avatarUrl} size={20} />, keywords: [me.username] },
    ...ws.activeUsers
      .filter((u) => u.id !== me.id)
      .map((u) => ({ value: u.id, label: u.name, icon: <Avatar name={u.name} src={u.avatarUrl} size={20} />, keywords: [u.username] })),
  ];
}

export function labelOptions(ws: WorkspaceData): PopupOption[] {
  const groups = new Map(ws.labels.filter((l) => l.isGroup).map((l) => [l.id, l.name]));
  return ws.labels
    .filter((l) => !l.isGroup)
    .map((l) => ({
      value: l.id,
      label: l.name,
      group: l.parentId ? groups.get(l.parentId) : undefined,
      icon: <ColorDot color={l.color} size={8} />,
      description: l.description ?? undefined,
    }))
    .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.label.localeCompare(b.label));
}

export function projectOptions(ws: WorkspaceData): PopupOption[] {
  return [
    { value: NONE, label: m.issue.noProject, icon: <Icon name="project" className="text-fg-subtlest" /> },
    ...ws.projects.map((p) => ({ value: p.id, label: p.name, icon: <ProjectIcon project={p} /> })),
  ];
}

export function teamOptions(ws: WorkspaceData): PopupOption[] {
  return ws.teams.map((t) => ({ value: t.id, label: t.name, description: t.key, icon: <TeamIcon team={t} />, keywords: [t.key] }));
}

export interface CycleOptionSource {
  id: string;
  name: string;
  isActive: boolean;
  isUpcoming: boolean;
  closedAt?: string | null;
}

export function cycleOptions(cycles: readonly CycleOptionSource[]): PopupOption[] {
  return [
    { value: NONE, label: m.issue.noCycle, icon: <Icon name="cycle" className="text-fg-subtlest" /> },
    ...cycles
      .filter((c) => !c.closedAt)
      .map((c) => ({
        value: c.id,
        label: c.name,
        description: c.isActive ? m.cycles.current : c.isUpcoming ? m.cycles.upcoming : undefined,
        icon: <Icon name="cycle" className={c.isActive ? 'text-primary' : 'text-fg-subtle'} />,
      })),
  ];
}

const SCALES: Record<EstimateScale, { value: number; label: string }[]> = {
  linear: [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })),
  fibonacci: [1, 2, 3, 5, 8, 13, 21].map((n) => ({ value: n, label: String(n) })),
  exponential: [1, 2, 4, 8, 16, 32].map((n) => ({ value: n, label: String(n) })),
  tshirt: [
    { value: 1, label: 'XS' },
    { value: 2, label: 'S' },
    { value: 3, label: 'M' },
    { value: 5, label: 'L' },
    { value: 8, label: 'XL' },
  ],
};

export function estimateLabel(scale: EstimateScale | undefined, value: number | null): string {
  if (value === null) return m.issue.noEstimate;
  const found = SCALES[scale ?? 'linear'].find((s) => s.value === value);
  return found ? (scale === 'tshirt' ? found.label : m.issue.estimatePoints(value)) : m.issue.estimatePoints(value);
}

export function estimateOptions(scale: EstimateScale | undefined): PopupOption[] {
  return [
    { value: NONE, label: m.issue.noEstimate, icon: <Icon name="chart" className="text-fg-subtlest" /> },
    { value: '0', label: scale === 'tshirt' ? '—' : m.issue.estimatePoints(0), icon: <Icon name="chart" className="text-fg-subtle" /> },
    ...SCALES[scale ?? 'linear'].map((s) => ({
      value: String(s.value),
      label: scale === 'tshirt' ? s.label : m.issue.estimatePoints(s.value),
      icon: <Icon name="chart" className="text-fg-subtle" />,
    })),
  ];
}

/** A compact property button used in the detail panel and create modal. */
export interface PropertyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  muted?: boolean;
  testId?: string;
}

export const PropertyButton = forwardRef<HTMLButtonElement, PropertyButtonProps>(function PropertyButton(
  { icon, children, muted, testId, className, ...rest },
  ref,
) {
  return (
    <button
      type="button"
      ref={ref}
      data-testid={testId}
      {...rest}
      className={clsx(
        'flex h-7 min-w-0 max-w-full items-center gap-2 rounded-sm px-2 text-left text-base transition-colors duration-100 hover:bg-hover',
        muted ? 'text-fg-subtlest' : 'text-fg',
        className,
      )}
    >
      {icon ? <span className="flex w-4 shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
});
