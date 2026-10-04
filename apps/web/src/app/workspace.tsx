import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type {
  BootstrapQuery,
  FavoriteFieldsFragment,
  LabelFieldsFragment,
  ProjectSummaryFieldsFragment,
  StatusFieldsFragment,
  TeamFieldsFragment,
  UserFieldsFragment,
  ViewerQuery,
  ViewFieldsFragment,
} from '@/gql/graphql';
import type { GroupingCatalog } from '@/lib/grouping';

export type Viewer = NonNullable<ViewerQuery['viewer']>;

export interface WorkspaceData {
  viewer: Viewer;
  workspace: BootstrapQuery['workspace'];
  teams: TeamFieldsFragment[];
  teamsById: ReadonlyMap<string, TeamFieldsFragment>;
  teamsByKey: ReadonlyMap<string, TeamFieldsFragment>;
  statusesById: ReadonlyMap<string, StatusFieldsFragment>;
  users: UserFieldsFragment[];
  activeUsers: UserFieldsFragment[];
  usersById: ReadonlyMap<string, UserFieldsFragment>;
  labels: LabelFieldsFragment[];
  labelsById: ReadonlyMap<string, LabelFieldsFragment>;
  projects: ProjectSummaryFieldsFragment[];
  projectsById: ReadonlyMap<string, ProjectSummaryFieldsFragment>;
  favorites: FavoriteFieldsFragment[];
  views: ViewFieldsFragment[];
  catalog: GroupingCatalog;
}

const WorkspaceContext = createContext<WorkspaceData | null>(null);

export function buildWorkspaceData(viewer: Viewer, data: BootstrapQuery): WorkspaceData {
  const teams = [...data.teams].filter((t) => !t.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder);
  const allTeams = data.teams;
  const statusesById = new Map<string, StatusFieldsFragment>();
  for (const t of allTeams) for (const s of t.statuses) statusesById.set(s.id, s);
  const users = [...data.users].sort((a, b) => a.name.localeCompare(b.name));
  const labels = [...data.labels].sort((a, b) => a.name.localeCompare(b.name));
  const projects = [...data.projects].filter((p) => !p.archivedAt).sort((a, b) => a.name.localeCompare(b.name));
  const teamsById = new Map(allTeams.map((t) => [t.id, t]));
  const usersById = new Map(users.map((u) => [u.id, u]));
  const labelsById = new Map(labels.map((l) => [l.id, l]));
  const projectsById = new Map(data.projects.map((p) => [p.id, p]));
  const cycles = new Map<string, { id: string; startsAt: string; name: string }>();
  for (const t of allTeams) if (t.activeCycle) cycles.set(t.activeCycle.id, t.activeCycle);
  return {
    viewer,
    workspace: data.workspace,
    teams,
    teamsById,
    teamsByKey: new Map(allTeams.map((t) => [t.key, t])),
    statusesById,
    users,
    activeUsers: users.filter((u) => !u.suspended && !u.removed),
    usersById,
    labels,
    labelsById,
    projects,
    projectsById,
    favorites: [...data.favorites].sort((a, b) => a.sortOrder - b.sortOrder),
    views: data.views,
    catalog: {
      teams: teamsById,
      statuses: statusesById,
      users: usersById,
      projects: projectsById,
      labels: labelsById,
      cycles,
    },
  };
}

export function WorkspaceProvider({ value, children }: { value: WorkspaceData; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceData {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside the app shell');
  return ctx;
}

export function useWorkspaceData(viewer: Viewer | null | undefined, data: BootstrapQuery | undefined): WorkspaceData | null {
  return useMemo(() => (viewer && data ? buildWorkspaceData(viewer, data) : null), [viewer, data]);
}

/** Team from a route `:key` param (case-insensitive). */
export function useTeamByKey(key: string | undefined): TeamFieldsFragment | null {
  const { teamsByKey } = useWorkspace();
  if (!key) return null;
  return teamsByKey.get(key.toUpperCase()) ?? null;
}
