import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { EmptyState, Icon, Skeleton, InlineMessage, Button } from '@velocity/ui';
import { InsightsDocument } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { ViewHeader } from '@/components/shell/ViewHeader';
import { DualLineChart, DualLineLegend } from '@/components/charts/DualLineChart';
import { VelocityBars } from '@/components/charts/VelocityBars';
import { TeamIcon } from '@/components/common/EntityIcons';
import { formatShortDate } from '@/lib/format';
import { describeError } from '@/lib/errors';
import { m } from '@/i18n';

/** Created vs completed links to the live list it summarizes: issues created in the same window. */
export const CREATED_VIEW_FILTER = 'createdAt gte:-12w';

function Card({ title, help, action, children, testId }: { title: string; help: string; action?: ReactNode; children: ReactNode; testId: string }) {
  return (
    <section aria-label={title} data-testid={testId} className="rounded-md border border-border bg-raised">
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          <p className="text-sm text-fg-subtle">{help}</p>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Insights() {
  const ws = useWorkspace();
  const { data, loading, error, refetch } = useQuery(InsightsDocument, { variables: { weeks: 12, cycles: 6 } });

  const weeks = useMemo(() => data?.createdVsCompleted ?? [], [data]);
  const totals = useMemo(() => weeks.reduce((acc, w) => ({ created: acc.created + w.created, completed: acc.completed + w.completed }), { created: 0, completed: 0 }), [weeks]);
  const points = useMemo(
    () =>
      weeks.map((w) => ({
        label: m.insights.weekOf(formatShortDate(w.weekStart.slice(0, 10))),
        tick: formatShortDate(w.weekStart.slice(0, 10)),
        a: w.created,
        b: w.completed,
      })),
    [weeks],
  );
  const teams = (data?.velocityByTeam ?? []).filter((t) => ws.teamsById.get(t.teamId)?.cycleEnabled !== false && t.cycles.length > 0);
  const viewHref = `/issues?filter=${encodeURIComponent(CREATED_VIEW_FILTER)}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader title={m.insights.title} icon={<Icon name="chart" className="text-fg-subtle" />} create={false} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-240 flex-col gap-5 p-5">
          {error && !data ? (
            <InlineMessage appearance="error" title={describeError(error).message} action={<Button size="sm" onClick={() => void refetch()}>{m.common.retry}</Button>} />
          ) : loading && !data ? (
            <>
              <Skeleton className="h-72 w-full" />
              <Skeleton className="h-56 w-full" />
            </>
          ) : (
            <>
              <Card
                testId="insights-created-completed"
                title={m.insights.createdVsCompleted}
                help={m.insights.createdVsCompletedHelp}
                action={
                  <Link
                    to={viewHref}
                    data-testid="insights-open-created"
                    className="-mr-2 flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-sm text-link hover:bg-hover"
                  >
                    {m.insights.openView}
                    <Icon name="arrow-right" className="h-3 w-3" />
                  </Link>
                }
              >
                {weeks.length === 0 ? (
                  <EmptyState icon="chart" message={m.insights.noData} />
                ) : (
                  <div className="flex flex-col gap-3">
                    <DualLineLegend aLabel={m.insights.created} bLabel={m.insights.completed} />
                    <DualLineChart
                      points={points}
                      aLabel={m.insights.created}
                      bLabel={m.insights.completed}
                      summary={m.insights.chartSummary(totals.created, totals.completed)}
                    />
                  </div>
                )}
              </Card>
              <Card testId="insights-velocity" title={m.insights.velocity} help={m.insights.velocityHelp}>
                {teams.length === 0 ? (
                  <EmptyState icon="cycle" message={m.insights.noCycles} />
                ) : (
                  <div className={teams.length > 1 ? 'grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2' : 'flex flex-col'}>
                    {teams.map((t) => {
                      const team = ws.teamsById.get(t.teamId);
                      return (
                        <div key={t.teamId} className="min-w-0">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {team ? <TeamIcon team={team} /> : null}
                              <h3 className="truncate text-base font-medium text-fg">{t.name}</h3>
                              <span className="identifier">{t.key}</span>
                            </div>
                            <Link to={`/team/${t.key}/cycles`} className="-mr-2 flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-sm text-link hover:bg-hover">
                              {m.insights.allCycles}
                              <Icon name="arrow-right" className="h-3 w-3" />
                            </Link>
                          </div>
                          <VelocityBars teamKey={t.key} teamName={t.name} bars={t.cycles} />
                          <ul aria-label={m.insights.legend} className="mt-1 flex items-center gap-4 text-sm text-fg-subtle">
                            <li className="flex items-center gap-2">
                              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: 'var(--ds-chart-1)' }} />
                              {m.insights.completedPoints}
                            </li>
                            <li className="flex items-center gap-2">
                              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm bg-neutral-hover" />
                              {m.insights.scopePoints}
                            </li>
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
