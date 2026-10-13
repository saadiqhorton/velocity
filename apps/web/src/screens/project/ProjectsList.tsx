import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import clsx from 'clsx';
import { Button, Checkbox, EmptyState, Icon, InlineMessage, Lozenge, Table } from '@velocity/ui';
import type { TableColumn } from '@velocity/ui';
import { ProjectsDocument } from '@/gql/graphql';
import { useTeamByKey } from '@/app/workspace';
import { ViewHeader } from '@/components/shell/ViewHeader';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';
import { segmentClass } from '@/components/common/PresetTabs';
import { ProjectIcon, TeamIcon } from '@/components/common/EntityIcons';
import { NotFound } from '@/screens/workspace/NotFound';
import { formatShortDate } from '@/lib/format';
import { describeError } from '@/lib/errors';
import { CreateProjectModal } from './CreateProjectModal';
import { statusLabel } from './projectUi';
import { ProjectHealthCell, ProjectLeadCell, ProjectStatusCell } from './ProjectInlineCells';
import type { ProjectRecord } from './projectUi';
import { m } from '@/i18n';

type StatusFilter = 'all' | 'active' | 'completed';
const FILTERS: StatusFilter[] = ['all', 'active', 'completed'];
const HEALTH_RANK: Record<string, number> = { off_track: 0, at_risk: 1, on_track: 2 };

function matches(p: ProjectRecord, f: StatusFilter): boolean {
  if (f === 'active') return p.status === 'planned' || p.status === 'in_progress';
  if (f === 'completed') return p.status === 'completed';
  return true;
}

export function ProjectsList() {
  const { key } = useParams();
  const team = useTeamByKey(key);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [showArchived, setShowArchived] = useState(false);
  const creating = params.get('new') === '1';
  const { data, loading, error, refetch } = useQuery(ProjectsDocument, {
    variables: { includeArchived: showArchived, teamId: team?.id },
    skip: Boolean(key) && !team,
  });

  const rows = useMemo(() => (data?.projects ?? []).filter((p) => matches(p, filter)), [data, filter]);

  const closeCreate = () =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('new');
        return p;
      },
      { replace: true },
    );
  const openCreate = () =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('new', '1');
        return p;
      },
      { replace: true },
    );

  if (key && !team) return <NotFound message={m.team.notFound} />;

  const columns: TableColumn<ProjectRecord>[] = [
    {
      key: 'name',
      header: m.common.name,
      sortable: true,
      sortValue: (p) => p.name.toLowerCase(),
      render: (p) => (
        <span className={clsx('flex min-w-0 items-center gap-2.5 font-medium text-fg', p.archivedAt && 'text-fg-subtle')}>
          <ProjectIcon project={p} />
          <span className="truncate">{p.name}</span>
          {p.archivedAt ? <Lozenge>{m.project.archivedTag}</Lozenge> : null}
        </span>
      ),
    },
    {
      key: 'health',
      header: m.project.health,
      sortable: true,
      width: 132,
      sortValue: (p) => (p.health ? (HEALTH_RANK[p.health] ?? 3) : 4),
      render: (p) => <ProjectHealthCell project={p} />,
    },
    {
      key: 'lead',
      header: m.project.lead,
      sortable: true,
      width: 168,
      sortValue: (p) => p.lead?.name.toLowerCase() ?? '\uffff',
      render: (p) => <ProjectLeadCell project={p} />,
    },
    {
      key: 'target',
      header: m.project.targetDate,
      sortable: true,
      width: 112,
      sortValue: (p) => p.targetDate ?? '9999-12-31',
      render: (p) =>
        p.targetDate ? (
          <span className="flex items-center gap-1.5 whitespace-nowrap text-fg-subtle">
            <Icon name="calendar" className="h-3.5 w-3.5 text-icon-subtle" />
            {formatShortDate(p.targetDate)}
          </span>
        ) : (
          <span className="block truncate whitespace-nowrap text-fg-subtlest">{m.project.noTarget}</span>
        ),
    },
    {
      key: 'teams',
      header: m.project.teams,
      width: 96,
      render: (p) => (
        <span className="flex items-center gap-1">
          {p.teams.slice(0, 3).map((t) => (
            <span key={t.id} className="identifier rounded-full border border-border px-1.5 leading-4.5" title={t.name}>
              {t.key}
            </span>
          ))}
          {p.teams.length > 3 ? <span className="text-sm text-fg-subtle">+{p.teams.length - 3}</span> : null}
        </span>
      ),
    },
    {
      key: 'issues',
      header: m.project.issuesColumn,
      sortable: true,
      align: 'right',
      width: 72,
      sortValue: (p) => p.progress.total,
      render: (p) => <span className="tabular-nums text-fg">{p.progress.total}</span>,
    },
    {
      key: 'progress',
      header: m.project.status,
      sortable: true,
      width: 108,
      sortValue: (p) => p.progress.percent,
      render: (p) => (
        <span title={`${statusLabel(p.status)} · ${m.cycles.stats(p.progress.done, p.progress.total)}`}>
          <ProjectStatusCell project={p} />
        </span>
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="projects-list">
      <ViewHeader
        title={team ? team.name : m.project.title}
        icon={team ? <TeamIcon team={team} /> : <Icon name="project" className="text-fg-subtle" />}
        count={loading && !data ? null : rows.length}
        create={false}
        actions={
          <>
            <span className="hidden lg:flex">
              <Checkbox label={m.project.showArchived} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            </span>
            <Button variant="subtle" size="sm" iconBefore={<Icon name="add" />} onClick={openCreate} className="ml-2" data-testid="new-project" aria-label={m.project.newProject}>
              <span className="hidden sm:inline">{m.project.newProject}</span>
            </Button>
          </>
        }
      >
        <div role="group" aria-label={m.project.statusFilter} className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={segmentClass(filter === f)}
            >
              {m.project.filters[f]}
            </button>
          ))}
        </div>
      </ViewHeader>
      {error && !data ? (
        <div className="p-5">
          <InlineMessage appearance="error" title={describeError(error).message} action={<Button size="sm" onClick={() => void refetch()}>{m.common.retry}</Button>} />
        </div>
      ) : loading && !data ? (
        <ContentSkeleton header={false} />
      ) : (
        <Table
          aria-label={m.project.title}
          inset
          className="min-h-0 flex-1"
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          defaultSort={{ key: 'name', direction: 'asc' }}
          onRowClick={(p) => navigate(`/project/${p.id}`)}
          emptyState={
            <EmptyState
              icon="project"
              message={filter === 'all' && !showArchived ? m.project.empty : m.project.emptyFiltered}
              action={
                <Button variant="primary" onClick={openCreate}>
                  {m.project.newProject}
                </Button>
              }
            />
          }
        />
      )}
      <CreateProjectModal open={creating} onClose={closeCreate} defaultTeamIds={team ? [team.id] : []} />
    </div>
  );
}
