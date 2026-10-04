import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Button, ConfirmDialog, DropdownMenu, Icon, IconButton, Lozenge, MenuItem, Tabs } from '@velocity/ui';
import type { TabItem } from '@velocity/ui';
import { DeleteProjectDocument, ProjectDetailDocument } from '@/gql/graphql';
import { ViewHeader } from '@/components/shell/ViewHeader';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';
import { ListScreen } from '@/components/issues/ListScreen';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { ProjectIcon } from '@/components/common/EntityIcons';
import { NotFound } from '@/screens/workspace/NotFound';
import { DEFAULT_DISPLAY } from '@/lib/viewState';
import type { ViewState } from '@/lib/viewState';
import { useOptimisticMutation } from '@/lib/mutation';
import { useUi } from '@/stores/ui';
import { ProjectOverview } from './ProjectOverview';
import { ProjectMilestones } from './ProjectMilestones';
import { ProjectActivity } from './ProjectActivity';
import { HealthBadge, statusAppearance, statusLabel, useArchiveProject, useUpdateProject } from './projectUi';
import { m } from '@/i18n';

const TABS = ['overview', 'issues', 'milestones', 'activity'] as const;
type Tab = (typeof TABS)[number];

export function ProjectDetail() {
  const { id = '', tab } = useParams();
  const navigate = useNavigate();
  const openCreate = useUi((s) => s.openCreate);
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
  const defaults = useMemo<ViewState>(() => ({ filter: '', display: DEFAULT_DISPLAY }), []);
  const current: Tab = (TABS as readonly string[]).includes(tab ?? '') ? (tab as Tab) : 'overview';

  if (!project) {
    if (loading) return <ContentSkeleton />;
    return <NotFound message={m.project.notFound} />;
  }
  const milestones = project.milestones;
  const teamId = project.teams[0]?.id;
  const go = (t: string) => navigate(t === 'overview' ? `/project/${id}` : `/project/${id}/${t}`);

  const items: TabItem[] = TABS.map((t) => ({ id: t, label: m.project[t] }));
  const archived = Boolean(project.archivedAt);

  const header = (
    <ViewHeader
      title={project.name}
      icon={<ProjectIcon project={project} size={20} />}
      create={false}
      actions={
        <>
          <FavoriteButton kind="project" targetId={project.id} />
          <DropdownMenu
            aria-label={m.project.actions}
            placement="bottom-end"
            trigger={<IconButton label={m.project.actions} icon={<Icon name="more" />} data-testid="project-menu" />}
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
      <div className="flex items-center gap-3 pl-1">
        <Lozenge appearance={statusAppearance(project.status)}>{statusLabel(project.status)}</Lozenge>
        <HealthBadge health={project.health} />
        {archived ? <Lozenge>{m.project.archivedTag}</Lozenge> : null}
      </div>
    </ViewHeader>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="project-detail">
      {header}
      <div className="shrink-0 px-5 pt-1">
        <Tabs aria-label={m.project.sections} items={items} value={current} onChange={go} />
      </div>
      <div className={clsx("flex min-h-0 flex-1 flex-col", current !== "issues" && "overflow-y-auto")} role="region" aria-label={m[`project`][current]}>
        {current === 'overview' ? <ProjectOverview project={project} milestones={milestones} save={(i) => void save(i)} /> : null}
        {current === 'issues' ? (
          <ListScreen
            embedded
            listId={`project-${project.id}`}
            title={project.name}
            scope={{ projectId: project.id }}
            defaults={defaults}
            context={{ projectId: project.id, teamId }}
            hiddenFilterFields={['project']}
            actions={
              <Button size="sm" variant="primary" iconBefore={<Icon name="add" />} onClick={() => openCreate({ projectId: project.id, teamId })}>
                {m.issue.newIssue}
              </Button>
            }
          />
        ) : null}
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
