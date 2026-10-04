import type { ReactNode } from 'react';
import { Avatar, Icon } from '@velocity/ui';
import type { LozengeAppearance, PopupOption } from '@velocity/ui';
import { ArchiveProjectDocument, UpdateProjectDocument } from '@/gql/graphql';
import type { PaletteColor, ProjectFieldsFragment, ProjectHealth, ProjectInput, ProjectStatus } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import type { WorkspaceData } from '@/app/workspace';
import { ColorDot, TeamIcon } from '@/components/common/EntityIcons';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';

export type ProjectRecord = ProjectFieldsFragment;

export const PROJECT_STATUSES: ProjectStatus[] = ['planned', 'in_progress', 'completed', 'canceled'];
export const PROJECT_HEALTHS: ProjectHealth[] = ['on_track', 'at_risk', 'off_track'];
export const PROJECT_COLORS: PaletteColor[] = ['blue', 'green', 'grey', 'pink', 'purple', 'red', 'teal', 'yellow'];
export const NONE = '__none__';

const STATUS_APPEARANCE: Record<string, LozengeAppearance> = {
  planned: 'default',
  in_progress: 'inprogress',
  completed: 'success',
  canceled: 'removed',
};
export const statusAppearance = (s: string): LozengeAppearance => STATUS_APPEARANCE[s] ?? 'default';

const HEALTH_COLOR: Record<string, PaletteColor> = { on_track: 'green', at_risk: 'yellow', off_track: 'red' };
export const healthColor = (h: string): PaletteColor => HEALTH_COLOR[h] ?? ('grey');

export const statusLabel = (s: string): string => (m.project.statuses as Record<string, string>)[s] ?? s;
export const healthLabel = (h: string): string => (m.project.healths as Record<string, string>)[h] ?? h;

/** Health is color + dot + text, never color alone. */
export function HealthBadge({ health }: { health: string | null | undefined }) {
  if (!health) return <span className="text-fg-subtlest">{m.project.noHealth}</span>;
  return (
    <span className="inline-flex items-center gap-2 text-fg">
      <ColorDot color={healthColor(health)} size={8} />
      {healthLabel(health)}
    </span>
  );
}

export function LeadCell({ lead }: { lead: { name: string; avatarUrl: string | null } | null | undefined }) {
  if (!lead) return <span className="text-fg-subtlest">{m.project.noLead}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-fg">
      <Avatar name={lead.name} src={lead.avatarUrl} size={20} />
      <span className="truncate">{lead.name}</span>
    </span>
  );
}

export const statusOptions = (): PopupOption[] =>
  PROJECT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }));

export const healthOptions = (): PopupOption[] => [
  { value: NONE, label: m.project.noHealth, icon: <ColorDot color="grey" size={8} /> },
  ...PROJECT_HEALTHS.map((h) => ({ value: h, label: healthLabel(h), icon: <ColorDot color={healthColor(h)} size={8} /> })),
];

export function leadOptions(ws: WorkspaceData): PopupOption[] {
  return [
    { value: NONE, label: m.project.noLead, icon: <Icon name="user" className="text-fg-subtlest" /> },
    ...ws.activeUsers.map((u) => ({ value: u.id, label: u.name, icon: <Avatar name={u.name} src={u.avatarUrl} size={20} />, keywords: [u.username] })),
  ];
}

export function teamOptions(ws: WorkspaceData): PopupOption[] {
  return ws.teams.map((t) => ({ value: t.id, label: t.name, description: t.key, icon: <TeamIcon team={t} />, keywords: [t.key] }));
}

export function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span className="w-28 shrink-0 pl-2 text-sm text-fg-subtlest">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Optimistic UpdateProject: the cached entity is patched with what the input implies. */
export function useUpdateProject(project: ProjectRecord | null | undefined) {
  const ws = useWorkspace();
  const [run] = useOptimisticMutation(UpdateProjectDocument, {
    optimistic: (vars) => {
      if (!project) throw new Error('project not cached');
      const i = vars.input;
      const leadId = i.leadId === undefined ? project.leadId : i.leadId;
      const lead = leadId ? ws.usersById.get(leadId) : null;
      const teams = i.teamIds ? i.teamIds.flatMap((id) => ws.teamsById.get(id) ?? []) : project.teams;
      return {
        __typename: 'Mutation' as const,
        updateProject: {
          ...project,
          name: i.name ?? project.name,
          icon: i.icon === undefined ? project.icon : i.icon,
          color: i.color ?? project.color,
          descriptionMd: i.descriptionMd ?? project.descriptionMd,
          status: i.status ?? project.status,
          health: i.health === undefined ? project.health : i.health,
          targetDate: i.targetDate === undefined ? project.targetDate : i.targetDate,
          leadId: leadId ?? null,
          lead: lead ? { __typename: 'User' as const, id: lead.id, name: lead.name, avatarUrl: lead.avatarUrl } : null,
          teams: teams.map((t) => ({ __typename: 'Team' as const, id: t.id, key: t.key, name: t.name })),
        },
      };
    },
    rollback: () => m.project.rollback.update,
  });
  return (input: ProjectInput) => (project ? run({ id: project.id, input }) : Promise.resolve({ data: null, error: null }));
}

export function useArchiveProject() {
  const [run] = useOptimisticMutation(ArchiveProjectDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      archiveProject: { __typename: 'Project' as const, id: vars.id, archivedAt: vars.archived ? new Date().toISOString() : null },
    }),
    rollback: () => m.project.rollback.archive,
    refetchQueries: ['Projects', 'Bootstrap'],
  });
  return (id: string, archived: boolean) => run({ id, archived });
}
