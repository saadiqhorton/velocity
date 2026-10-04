import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Button, EmptyState, Icon, PopupSelect, ProgressBar } from '@velocity/ui';
import type { PopupOption } from '@velocity/ui';
import { TeamCyclesDocument } from '@/gql/graphql';
import type { CycleDetailFieldsFragment } from '@/gql/graphql';
import { useTeamByKey } from '@/app/workspace';
import { ListScreen } from '@/components/issues/ListScreen';
import { TeamIcon } from '@/components/common/EntityIcons';
import { DEFAULT_DISPLAY } from '@/lib/viewState';
import type { ViewState } from '@/lib/viewState';
import { formatShortDate } from '@/lib/format';
import { useUi } from '@/stores/ui';
import { NotFound } from '@/screens/workspace/NotFound';
import { m } from '@/i18n';

/** Without cycles: todo + in progress + done in the last week (SPEC §4.11.1). */
export const ACTIVE_WITHOUT_CYCLES = 'statusCategory in:todo,in_progress or (statusCategory:done and completedAt gte:-1w)';

export function cycleProgress(c: Pick<CycleDetailFieldsFragment, 'liveStats' | 'stats' | 'closedAt'>): { done: number; total: number; percent: number } {
  const s = c.closedAt && c.stats ? c.stats : c.liveStats;
  const total = s.scopeCount;
  const done = s.completedCount;
  return { done, total, percent: total > 0 ? (done / total) * 100 : 0 };
}

function cycleLabel(c: Pick<CycleDetailFieldsFragment, 'name' | 'startsAt' | 'endsAt'>): string {
  return `${c.name} · ${m.time.range(formatShortDate(c.startsAt), formatShortDate(c.endsAt))}`;
}

export function TeamActive() {
  const { key } = useParams();
  const team = useTeamByKey(key);
  const [params, setParams] = useSearchParams();
  const openCreate = useUi((s) => s.openCreate);
  const cyclesQ = useQuery(TeamCyclesDocument, {
    variables: { teamId: team?.id ?? '', includeClosed: true, first: 12 },
    skip: !team?.cycleEnabled,
  });
  const defaults = useMemo<ViewState>(() => ({ filter: '', display: DEFAULT_DISPLAY }), []);

  const cycles = useMemo(() => cyclesQ.data?.cycles ?? [], [cyclesQ.data]);
  const cycleNames = useMemo(() => new Map(cycles.map((c) => [c.id, c.name])), [cycles]);

  if (!team) return <NotFound message={m.team.notFound} />;

  const selectedId = params.get('cycle') ?? team.activeCycle?.id ?? null;
  const cycle = cycles.find((c) => c.id === selectedId) ?? null;
  const usesCycles = team.cycleEnabled && Boolean(selectedId);

  const options: PopupOption[] = cycles.map((c) => ({
    value: c.id,
    label: cycleLabel(c),
    group: c.isActive ? m.cycles.current : c.isUpcoming ? m.cycles.upcoming : m.cycles.closed,
    icon: <Icon name="cycle" className={c.isActive ? 'text-primary' : 'text-fg-subtle'} />,
  }));

  const progress = cycle ? cycleProgress(cycle) : null;

  const headerExtra = usesCycles ? (
    <div className="flex shrink-0 items-center gap-3 pr-2">
      <PopupSelect
        label={m.team.cyclePicker}
        options={options}
        value={selectedId}
        triggerVariant="subtle"
        triggerSize="sm"
        placeholder={team.activeCycle?.name ?? m.team.noActiveCycle}
        onChange={(id: string) =>
          setParams(
            (prev) => {
              const p = new URLSearchParams(prev);
              if (id === team.activeCycle?.id) p.delete('cycle');
              else p.set('cycle', id);
              return p;
            },
            { replace: true },
          )
        }
        renderTrigger={(t) => (
          <Button
            ref={t.ref as never}
            size="sm"
            variant="subtle"
            onClick={t.onClick}
            onKeyDown={t.onKeyDown}
            aria-haspopup="listbox"
            aria-expanded={t.open}
            iconBefore={<Icon name="cycle" />}
            iconAfter={<Icon name="chevron-down" className="h-3 w-3" />}
            data-testid="cycle-picker"
          >
            {cycle?.name ?? team.activeCycle?.name ?? m.team.noActiveCycle}
          </Button>
        )}
      />
      {progress ? (
        <div className="hidden w-36 items-center gap-2 lg:flex" title={m.cycles.stats(progress.done, progress.total)} data-testid="cycle-progress">
          <ProgressBar value={progress.percent} label={m.cycles.progress} className="flex-1" />
          <span className="shrink-0 text-sm text-fg-subtle">{Math.round(progress.percent)}%</span>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <ListScreen
      listId={`team-active-${team.id}`}
      title={team.name}
      icon={<TeamIcon team={team} />}
      scope={usesCycles && selectedId ? { teamId: team.id, cycleId: selectedId } : { teamId: team.id }}
      defaults={defaults}
      extraFilters={usesCycles ? [] : [ACTIVE_WITHOUT_CYCLES]}
      context={{ teamId: team.id, cycleId: usesCycles ? selectedId : undefined }}
      headerExtra={headerExtra}
      hiddenFilterFields={['team']}
      cycleNames={cycleNames}
      empty={
        <EmptyState
          icon="active"
          message={m.list.emptyTeam}
          action={
            <Button variant="primary" onClick={() => openCreate({ teamId: team.id, cycleId: usesCycles ? selectedId : undefined })}>
              {m.issue.createIssue}
            </Button>
          }
        />
      }
    />
  );
}
