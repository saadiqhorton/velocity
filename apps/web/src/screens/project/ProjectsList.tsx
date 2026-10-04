import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import clsx from 'clsx';
import { Button, Checkbox, EmptyState, Icon, InlineMessage, Lozenge, ProgressBar, Table } from '@velocity/ui';
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
import { HealthBadge, LeadCell, statusAppearance, statusLabel } from './projectUi';
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
        <span className={clsx('flex min-w-0 items-center gap-2 font-medium text-fg', p.archivedAt && 'text-fg-subtle')}>
          <ProjectIcon project={p} />
          <span className="truncate">{p.name}</span>
          {p.archivedAt ? <Lozenge>{m.project.archivedTag}</Lozenge> : null}
        </span>
      ),
    },
    {
      key: 'status',
      header: m.project.status,
      sortable: true,
      width: 112,
      sortValue: (p) => ['planned', 'in_progress', 'completed', 'canceled'].indexOf(p.status),
      render: (p) => <Lozenge appearance={statusAppearance(p.status)}>{statusLabel(p.status)}</Lozenge>,
    },
    {
      key: 'lead',
      header: m.project.lead,
      sortable: true,
      width: 148,
      sortValue: (p) => p.lead?.name.toLowerCase() ?? '￿',
      render: (p) => <LeadCell lead={p.lead} />,
    },
    {
      key: 'progress',
      header: m.project.progress,
      sortable: true,
      width: 136,
      sortValue: (p) => p.progress.percent,
      render: (p) => (
        <span className="flex items-center gap-2" title={m.cycles.stats(p.progress.done, p.progress.total)}>
          <ProgressBar value={p.progress.percent} label={`${m.project.progress}: ${p.name}`} className="flex-1" />
          <span className="w-9 shrink-0 text-right text-sm tabular-nums text-fg-subtle">{Math.round(p.progress.percent)}%</span>
        </span>
      ),
    },
    {
      key: 'target',
      header: m.project.targetDate,
      sortable: true,
      width: 128,
      sortValue: (p) => p.targetDate ?? '9999-12-31',
      render: (p) =>
        p.targetDate ? (
          <span className="whitespace-nowrap text-fg-subtle">{formatShortDate(p.targetDate)}</span>
        ) : (
          <span className="block truncate whitespace-nowrap text-fg-subtlest">{m.project.noTarget}</span>
        ),
    },
    {
      key: 'health',
      header: m.project.health,
      sortable: true,
      width: 112,
      sortValue: (p) => (p.health ? (HEALTH_RANK[p.health] ?? 3) : 4),
      render: (p) => <HealthBadge health={p.health} />,
    },
    {
      key: 'teams',
      header: m.project.teams,
      width: 104,
      render: (p) => (
        <span className="flex items-center gap-1">
          {p.teams.slice(0, 3).map((t) => (
            <span key={t.id} className="identifier rounded-sm bg-neutral px-1" title={t.name}>
              {t.key}
            </span>
          ))}
          {p.teams.length > 3 ? <span className="text-sm text-fg-subtle">+{p.teams.length - 3}</span> : null}
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
            <Button variant="primary" iconBefore={<Icon name="add" />} onClick={openCreate} className="ml-2" data-testid="new-project" aria-label={m.project.newProject}>
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
