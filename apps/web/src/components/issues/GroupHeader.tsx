import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Avatar, Icon, IconButton, PriorityIcon, StatusDot } from '@velocity/ui';
import type { WorkspaceData } from '@/app/workspace';
import type { GroupBy } from '@/lib/grouping';
import type { CreateDefaults } from '@/stores/ui';
import { ColorDot, ProjectIcon, TeamIcon } from '@/components/common/EntityIcons';
import { PRIORITY_KEYS } from './IssueRow';
import { m } from '@/i18n';

export interface GroupInfo {
  label: string;
  icon: ReactNode;
  /** Create-issue defaults for the "+" button. */
  defaults: CreateDefaults;
}

export function groupInfo(groupBy: GroupBy, key: string | null, ws: WorkspaceData, cycleNames?: ReadonlyMap<string, string>): GroupInfo {
  switch (groupBy) {
    case 'status': {
      const s = key ? ws.statusesById.get(key) : undefined;
      return {
        label: s?.name ?? m.common.unknown,
        icon: <StatusDot color={s?.color ?? 'grey'} />,
        defaults: s ? { statusId: s.id, teamId: s.teamId } : {},
      };
    }
    case 'priority': {
      const p = key === null ? 4 : Number(key);
      return { label: m.priority[p as 0 | 1 | 2 | 3 | 4], icon: <PriorityIcon priority={PRIORITY_KEYS[p] ?? 'none'} />, defaults: { priority: p } };
    }
    case 'assignee': {
      const u = key ? ws.usersById.get(key) : undefined;
      return u
        ? { label: u.name, icon: <Avatar name={u.name} src={u.avatarUrl} size={16} />, defaults: { assigneeId: u.id } }
        : { label: m.issue.noAssignee, icon: <Icon name="user" className="text-fg-subtlest" />, defaults: { assigneeId: null } };
    }
    case 'project': {
      const p = key ? ws.projectsById.get(key) : undefined;
      return p
        ? { label: p.name, icon: <ProjectIcon project={p} />, defaults: { projectId: p.id } }
        : { label: m.issue.noProject, icon: <Icon name="project" className="text-fg-subtlest" />, defaults: { projectId: null } };
    }
    case 'cycle': {
      const name = key ? (cycleNames?.get(key) ?? ws.catalog.cycles?.get(key)?.name) : undefined;
      return key
        ? { label: name ?? m.issue.cycle, icon: <Icon name="cycle" className="text-fg-subtle" />, defaults: { cycleId: key } }
        : { label: m.issue.noCycle, icon: <Icon name="cycle" className="text-fg-subtlest" />, defaults: { cycleId: null } };
    }
    case 'team': {
      const t = key ? ws.teamsById.get(key) : undefined;
      return t
        ? { label: t.name, icon: <TeamIcon team={t} />, defaults: { teamId: t.id } }
        : { label: m.common.unknown, icon: null, defaults: {} };
    }
    case 'label': {
      const l = key ? ws.labelsById.get(key) : undefined;
      return l
        ? { label: l.name, icon: <ColorDot color={l.color} size={6} />, defaults: { labelIds: [l.id] } }
        : { label: m.issue.noLabels, icon: <Icon name="label" className="text-fg-subtlest" />, defaults: {} };
    }
    default:
      return { label: m.list.issues, icon: null, defaults: {} };
  }
}

export interface GroupHeaderProps {
  info: GroupInfo;
  count: number;
  collapsed: boolean;
  rowIndex: number;
  onToggle: () => void;
  onCreate?: () => void;
  sticky?: boolean;
}

/** Sticky group header (SPEC §4.10.2): dot + name (12px semibold) + count + collapse chevron. */
export function GroupHeader({ info, count, collapsed, rowIndex, onToggle, onCreate, sticky }: GroupHeaderProps) {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 1}
      aria-expanded={!collapsed}
      data-testid="group-header"
      className={clsx(
        'group/header flex h-8 items-center gap-2 border-y border-border bg-sunken pl-2 pr-3',
        sticky && 'shadow-none',
      )}
    >
      <div role="gridcell" className="flex min-w-0 flex-1 items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? m.list.expandGroup(info.label) : m.list.collapseGroup(info.label)}
          className="flex h-6 min-w-0 items-center gap-2 rounded-sm px-1 text-sm transition-colors duration-100 hover:bg-hover"
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} className="h-3 w-3 text-fg-subtlest" />
          <span className="flex w-4 shrink-0 items-center justify-center">{info.icon}</span>
          <span className="truncate font-semibold text-fg-subtle">{info.label}</span>
          <span className="text-fg-subtlest">{count}</span>
        </button>
      </div>
      {onCreate ? (
        <div role="gridcell" className="opacity-0 transition-opacity duration-100 group-hover/header:opacity-100 focus-within:opacity-100">
          <IconButton label={m.issue.newIssue} size="sm" icon={<Icon name="add" />} onClick={onCreate} />
        </div>
      ) : null}
    </div>
  );
}
