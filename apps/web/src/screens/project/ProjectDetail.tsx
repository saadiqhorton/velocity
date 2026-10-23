import { useState } from 'react';
import clsx from 'clsx';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { ConfirmDialog, DropdownMenu, Icon, IconButton, Lozenge, MenuItem, Tabs } from '@velocity/ui';
import type { TabItem } from '@velocity/ui';
import { DeleteProjectDocument, ProjectDetailDocument } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { ViewHeader } from '@/components/shell/ViewHeader';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { ProjectIcon, TeamIcon } from '@/components/common/EntityIcons';
import { NotFound } from '@/screens/workspace/NotFound';
import { useOptimisticMutation } from '@/lib/mutation';
import { ProjectOverview } from './ProjectOverview';
import { ProjectMilestones } from './ProjectMilestones';
import { ProjectActivity } from './ProjectActivity';
import { ProjectIssues } from './ProjectIssues';
import { useArchiveProject, useUpdateProject } from './projectUi';
import { m } from '@/i18n';

const TABS = ['overview', 'issues', 'milestones', 'activity'] as const;
type Tab = (typeof TABS)[number];

export function ProjectDetail() {
  const { id = '', tab } = useParams();
  const navigate = useNavigate();
  const { teamsById } = useWorkspace();
  const { data, loading } = useQuery(ProjectDetailDocument, { variables: { id } });
  const project = data?.project ?? null;
  const save = useUpdateProject(project);
  const archive = useArchiveProject();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [del] = useOptimisticMutation(DeleteProjectDocument, {
    optimistic: { serverConfirmed: 'Deleting a project cascades to issues and sidebar entries on the server' },
    rollback: () => m.flags.rollback.delete,
    refetchQueries: ['Projects', 'Bootstrap'],
  });
  const current: Tab = (TABS as readonly string[]).includes(tab ?? '') ? (tab as Tab) : 'overview';

  if (!project) {
    if (loading) return <ContentSkeleton />;
    return <NotFound message={m.project.notFound} />;
  }
  const milestones = project.milestones;
  const leadTeam = project.teams[0] ? teamsById.get(project.teams[0].id) : undefined;
  const teamId = project.teams[0]?.id;
  const go = (t: string) => navigate(t === 'overview' ? `/project/${id}` : `/project/${id}/${t}`);

  const items: TabItem[] = TABS.map((t) => ({ id: t, label: m.project[t] }));
  const archived = Boolean(project.archivedAt);

  const header = (
    <ViewHeader
      title={project.name}
      icon={<ProjectIcon project={project} />}
      breadcrumbs={[
        ...(leadTeam ? [{ label: leadTeam.name, to: `/team/${leadTeam.key}/active`, icon: <TeamIcon team={leadTeam} /> }] : []),
        { label: m.project.title, to: '/projects' },
      ]}
      create={false}
      actions={
        <>
          <FavoriteButton kind="project" targetId={project.id} size="sm" />
          <DropdownMenu
            aria-label={m.project.actions}
            placement="bottom-end"
            trigger={<IconButton label={m.project.actions} size="sm" icon={<Icon name="more" />} data-testid="project-menu" />}
          >
            <MenuItem
              icon={<Icon name="archive" />}
              onSelect={() => void archive(project.id, !archived)}
            >
              {archived ? m.common.unarchive : m.common.archive}
            </MenuItem>
            <MenuItem icon={<Icon name="trash" />} danger onSelect={() => setConfirmDelete(true)}>
              {m.common.delete}
            </MenuItem>
          </DropdownMenu>
        </>
      }
    >
      {archived ? <Lozenge>{m.project.archivedTag}</Lozenge> : null}
    </ViewHeader>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="project-detail">
      {header}
      <div className="flex h-11 shrink-0 items-center px-4">
        <Tabs variant="pill" aria-label={m.project.sections} items={items} value={current} onChange={go} />
      </div>
      <div className={clsx("flex min-h-0 flex-1 flex-col", current !== "issues" && "overflow-y-auto")} role="region" aria-label={m[`project`][current]}>
        {current === 'overview' ? <ProjectOverview project={project} milestones={milestones} save={(i) => void save(i)} /> : null}
        {current === 'issues' ? <ProjectIssues projectId={project.id} projectName={project.name} teamId={teamId} milestones={milestones} /> : null}
        {current === 'milestones' ? <ProjectMilestones projectId={project.id} milestones={milestones} /> : null}
        {current === 'activity' ? <ProjectActivity projectId={project.id} /> : null}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          const { error } = await del({ id: project.id });
          if (!error) navigate('/projects');
        }}
        title={m.project.deleteConfirm}
        description={m.project.deleteBody}
        confirmLabel={m.common.delete}
        destructive
      />
    </div>
  );
}
