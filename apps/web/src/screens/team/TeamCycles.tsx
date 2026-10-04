import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import clsx from 'clsx';
import { Button, ConfirmDialog, EmptyState, Icon, IconButton, InlineMessage, Lozenge, Popover, ProgressBar, useFlags } from '@velocity/ui';
import { CloseCycleDocument, IssueListDocument, RenameCycleDocument, RotateCyclesDocument, TeamCyclesDocument } from '@/gql/graphql';
import type { CycleDetailFieldsFragment } from '@/gql/graphql';
import { useTeamByKey } from '@/app/workspace';
import { ListScreen } from '@/components/issues/ListScreen';
import { ViewHeader } from '@/components/shell/ViewHeader';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';
import { TeamIcon } from '@/components/common/EntityIcons';
import { Sparkline } from '@/components/charts/Sparkline';
import { NotFound } from '@/screens/workspace/NotFound';
import { DEFAULT_DISPLAY } from '@/lib/viewState';
import type { ViewState } from '@/lib/viewState';
import { useOptimisticMutation } from '@/lib/mutation';
import { useOpenIssue } from '@/lib/navigation';
import { describeError } from '@/lib/errors';
import { formatDate, formatShortDate } from '@/lib/format';
import { useUi } from '@/stores/ui';
import { cycleProgress } from './TeamActive';
import { m } from '@/i18n';

type Cycle = CycleDetailFieldsFragment;

const DAY = 86_400_000;

function cyclePoints(c: Cycle): { done: number; total: number } {
  const s = c.closedAt && c.stats ? c.stats : c.liveStats;
  return { done: s.completedPoints, total: s.scopePoints };
}

function statusOf(c: Cycle): 'current' | 'upcoming' | 'closed' {
  return c.closedAt ? 'closed' : c.isActive ? 'current' : 'upcoming';
}

function timingText(c: Cycle): string {
  if (c.closedAt) return m.cycles.closedOn(formatShortDate(c.closedAt));
  if (c.isUpcoming) return m.cycles.startsOn(formatShortDate(c.startsAt));
  const days = Math.max(0, Math.ceil((Date.parse(c.endsAt) - Date.now()) / DAY));
  return m.time.daysLeft(days);
}

function InlineCycleName({ cycle }: { cycle: Cycle }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(cycle.name);
  const [rename] = useOptimisticMutation(RenameCycleDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      renameCycle: {
        __typename: 'Cycle' as const,
        id: cycle.id,
        number: cycle.number,
        name: vars.name?.trim() ? vars.name.trim() : m.cycles.defaultName(cycle.number),
        customName: vars.name?.trim() ? vars.name.trim() : null,
        startsAt: cycle.startsAt,
        endsAt: cycle.endsAt,
        closedAt: cycle.closedAt,
        isActive: cycle.isActive,
        isUpcoming: cycle.isUpcoming,
        teamId: cycle.teamId,
      },
    }),
    rollback: () => m.flags.rollback.generic,
  });
  const commit = () => {
    setEditing(false);
    const next = value.trim();
    if (next === cycle.name) return;
    // An empty name restores the default "Cycle N".
    void rename({ id: cycle.id, name: next === '' ? null : next });
  };
  if (editing) {
    return (
      <input
        autoFocus
        aria-label={m.cycles.rename}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setValue(cycle.name);
            setEditing(false);
          }
        }}
        className="h-8 w-48 rounded-sm border border-border-input bg-surface px-2 text-md font-semibold text-fg"
        data-testid="cycle-name-input"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setValue(cycle.name);
        setEditing(true);
      }}
      title={m.cycles.rename}
      aria-label={`${m.cycles.rename}: ${cycle.name}`}
      className="group flex h-8 min-w-0 items-center gap-2 rounded-sm px-2 text-md font-semibold text-fg hover:bg-hover"
      data-testid="cycle-name"
    >
      <span className="truncate">{cycle.name}</span>
      <Icon name="edit" className="h-3 w-3 shrink-0 text-fg-subtlest opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}

function AddedAfterStart({ cycle }: { cycle: Cycle }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const openIssue = useOpenIssue();
  const count = cycle.addedAfterStartIssueIds.length;
  const { data, loading } = useQuery(IssueListDocument, { variables: { cycleId: cycle.id, first: 200, includeSubIssues: true }, skip: !open });
  const ids = useMemo(() => new Set(cycle.addedAfterStartIssueIds), [cycle.addedAfterStartIssueIds]);
  const issues = (data?.issues.nodes ?? []).filter((i) => ids.has(i.id));
  if (count === 0) return <span className="text-sm text-fg-subtle">{m.cycles.noScopeChange}</span>;
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 items-center gap-1 rounded-sm px-2 text-sm text-fg hover:bg-hover"
        data-testid="added-after-start"
      >
        <Icon name="add" className="h-3 w-3 text-fg-subtle" />
        {m.cycles.addedAfterStartCount(count)}
      </button>
      <Popover anchorEl={anchor} open={open} onDismiss={() => setOpen(false)} placement="bottom-start" className="w-72 p-2" role="dialog" aria-label={m.cycles.addedAfterStart}>
        <h3 className="px-2 pb-1 text-sm font-semibold text-fg-subtle">{m.cycles.addedAfterStart}</h3>
        {loading && !data ? (
          <p className="px-2 py-1 text-sm text-fg-subtle">{m.common.loading}</p>
        ) : (
          <ul className="max-h-60 overflow-y-auto">
            {issues.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    openIssue(i.id, { identifier: i.identifier });
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-hover"
                >
                  <span className="identifier shrink-0">{i.identifier}</span>
                  <span className="min-w-0 truncate text-base text-fg">{i.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold uppercase text-fg-subtlest">{label}</span>
      <div className="flex min-h-7 items-center gap-2">{children}</div>
    </div>
  );
}

interface HeaderProps {
  cycle: Cycle;
  teamKey: string;
  prev: Cycle | null;
  next: Cycle | null;
  active: Cycle | null;
  velocity: { number: number; completedPoints: number }[];
  average: number;
  onClose: () => void;
}

function CycleHeader({ cycle, teamKey, prev, next, active, velocity, average, onClose }: HeaderProps) {
  const progress = cycleProgress(cycle);
  const pts = cyclePoints(cycle);
  const status = statusOf(cycle);
  const values = velocity.map((v) => v.completedPoints);
  const to = (c: Cycle) => `/team/${teamKey}/cycles/${c.id}`;
  const navigate = useNavigate();
  return (
    <div className="shrink-0 border-b border-border px-5 py-3" data-testid="cycle-header">
      <div className="flex items-center gap-1">
        <IconButton label={m.cycles.previousCycle} size="sm" icon={<Icon name="chevron-left" />} disabled={!prev} onClick={() => prev && navigate(to(prev))} />
        <InlineCycleName cycle={cycle} />
        <IconButton label={m.cycles.nextCycle} size="sm" icon={<Icon name="chevron-right" />} disabled={!next} onClick={() => next && navigate(to(next))} />
        <Lozenge appearance={status === 'current' ? 'inprogress' : status === 'closed' ? 'default' : 'new'} className="ml-2">
          {m.cycles.statuses[status]}
        </Lozenge>
        {status !== 'current' && active ? (
          <Link to={to(active)} className="ml-2 rounded-sm px-1 text-sm text-link hover:bg-hover">
            {m.cycles.goToCurrent}
          </Link>
        ) : null}
        <span className="ml-3 hidden min-w-0 truncate text-sm text-fg-subtle md:inline" data-testid="cycle-dates">
          {m.time.range(formatDate(cycle.startsAt), formatDate(cycle.endsAt))} · {timingText(cycle)}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {status === 'current' ? (
            <Button size="sm" onClick={onClose} data-testid="close-cycle">
              {m.cycles.closeEarly}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="px-2 pt-1 text-sm text-fg-subtle md:hidden">
        {m.time.range(formatDate(cycle.startsAt), formatDate(cycle.endsAt))} · {timingText(cycle)}
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-x-10 gap-y-3 px-2">
        <Stat label={m.cycles.progress}>
          <div className="w-40">
            <ProgressBar value={progress.percent} label={`${m.cycles.progress}: ${cycle.name}`} />
          </div>
          <span className="text-sm text-fg" data-testid="cycle-stats">
            {m.cycles.stats(progress.done, progress.total)}
          </span>
          <span className="text-sm text-fg-subtle">{m.cycles.points(pts.done, pts.total)}</span>
        </Stat>
        <Stat label={m.cycles.velocity}>
          {values.length > 0 ? (
            <>
              <Sparkline values={values} label={m.cycles.velocitySummary(values)} />
              <span className="text-sm text-fg-subtle" title={m.cycles.velocityHelp}>
                {m.cycles.averagePoints(Math.round(average * 10) / 10)}
              </span>
            </>
          ) : (
            <span className="text-sm text-fg-subtle">{m.cycles.noVelocity}</span>
          )}
        </Stat>
        <Stat label={m.cycles.scope}>
          <AddedAfterStart cycle={cycle} />
          {cycle.closedAt && cycle.stats ? (
            <span className="text-sm text-fg-subtle">{m.cycles.carriedOver(cycle.stats.carriedOverCount)}</span>
          ) : null}
        </Stat>
      </div>
    </div>
  );
}

function ClosedArchive({ cycles, teamKey }: { cycles: Cycle[]; teamKey: string }) {
  if (cycles.length === 0) return <EmptyState icon="cycle" message={m.cycles.archiveEmpty} />;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-testid="closed-cycles">
      <ul aria-label={m.cycles.closed} className="mx-auto max-w-240 rounded-md border border-border bg-raised">
        {cycles.map((c) => {
          const p = cycleProgress(c);
          const pts = cyclePoints(c);
          return (
            <li key={c.id} className="border-b border-border last:border-b-0">
              <Link to={`/team/${teamKey}/cycles/${c.id}`} className="flex h-12 items-center gap-4 px-4 hover:bg-hover">
                <span className="w-24 shrink-0 truncate text-base font-medium text-fg">{c.name}</span>
                <span className="hidden w-40 shrink-0 text-sm text-fg-subtle md:block">{m.time.range(formatShortDate(c.startsAt), formatShortDate(c.endsAt))}</span>
                <span className="w-28 shrink-0">
                  <ProgressBar value={p.percent} label={`${m.cycles.progress}: ${c.name}`} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{m.cycles.completedOfScope(p.done, p.total)}</span>
                <span className="w-24 shrink-0 text-right text-sm text-fg-subtle">{m.cycles.points(pts.done, pts.total)}</span>
                <Icon name="chevron-right" className="h-3 w-3 shrink-0 text-fg-subtlest" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TeamCycles() {
  const { key, cycleId } = useParams();
  const team = useTeamByKey(key);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const openCreate = useUi((s) => s.openCreate);
  const { showFlag } = useFlags();
  const [confirmClose, setConfirmClose] = useState(false);
  const closedView = params.get('view') === 'closed';
  const { data, loading, error, refetch } = useQuery(TeamCyclesDocument, {
    variables: { teamId: team?.id ?? '', includeClosed: true, first: 40 },
    skip: !team?.cycleEnabled,
  });
  const [closeCycle, { loading: closing }] = useOptimisticMutation(CloseCycleDocument, {
    optimistic: { serverConfirmed: 'Closing snapshots stats, carries issues over and opens the next cycle on the server' },
    rollback: () => m.cycles.closeFailed,
    refetchQueries: ['TeamCycles', 'CycleDetail', 'Bootstrap'],
  });
  const [rotate, { loading: rotating }] = useOptimisticMutation(RotateCyclesDocument, {
    optimistic: { serverConfirmed: 'Rotation creates cycles according to the team schedule on the server' },
    rollback: () => m.cycles.rotateFailed,
    refetchQueries: ['TeamCycles', 'Bootstrap'],
  });
  const defaults = useMemo<ViewState>(() => ({ filter: '', display: DEFAULT_DISPLAY }), []);

  const all = useMemo(() => [...(data?.cycles ?? [])].sort((a, b) => a.number - b.number), [data]);
  const closed = useMemo(() => all.filter((c) => c.closedAt).sort((a, b) => b.number - a.number), [all]);
  const active = all.find((c) => c.isActive && !c.closedAt) ?? null;

  if (!team) return <NotFound message={m.team.notFound} />;

  const rotateButton = (
    <Button
      size="sm"
      variant="subtle"
      loading={rotating}
      iconBefore={<Icon name="refresh" />}
      onClick={async () => {
        const res = await rotate({ teamId: team.id });
        if (res.data) showFlag({ title: res.data.rotateCycles > 0 ? m.cycles.rotated(res.data.rotateCycles) : m.cycles.rotatedNone, severity: 'success' });
      }}
      data-testid="rotate-cycles"
    >
      {m.cycles.rotate}
    </Button>
  );

  if (!team.cycleEnabled) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ViewHeader title={m.team.cyclesTitle} icon={<TeamIcon team={team} />} create={false} />
        <EmptyState
          icon="cycle"
          message={m.team.cyclesOff}
          action={
            <Link
              to={`/settings/teams/${team.key}/cycles`}
              className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-base font-medium text-fg-inverse hover:opacity-90"
              data-testid="enable-cycles"
            >
              {m.team.enableCycles}
            </Link>
          }
        />
      </div>
    );
  }

  const setView = (view: 'cycle' | 'closed') =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (view === 'closed') p.set('view', 'closed');
        else p.delete('view');
        return p;
      },
      { replace: true },
    );

  const viewTabs = (
    <div role="group" aria-label={m.team.cyclesTitle} className="flex items-center gap-1">
      {(['cycle', 'closed'] as const).map((v) => {
        const on = (v === 'closed') === closedView;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => setView(v)}
            className={clsx('h-7 rounded-sm px-2 text-base transition-colors duration-100', on ? 'bg-neutral font-medium text-fg' : 'text-fg-subtle hover:bg-hover hover:text-fg')}
          >
            {v === 'cycle' ? m.cycles.viewCycle : `${m.cycles.closed} (${closed.length})`}
          </button>
        );
      })}
    </div>
  );

  if (error && !data) {
    return (
      <div className="p-5">
        <InlineMessage appearance="error" title={describeError(error).message} action={<Button size="sm" onClick={() => void refetch()}>{m.common.retry}</Button>} />
      </div>
    );
  }
  if (loading && !data) return <ContentSkeleton />;

  const selected = all.find((c) => c.id === cycleId) ?? active ?? all.filter((c) => !c.closedAt)[0] ?? all[all.length - 1] ?? null;
  if (cycleId && !selected) return <NotFound message={m.cycles.notFound} />;

  if (closedView || !selected) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="team-cycles">
        <ViewHeader title={m.team.cyclesTitle} icon={<TeamIcon team={team} />} create={false} actions={rotateButton}>
          {viewTabs}
        </ViewHeader>
        {!selected && !closedView ? (
          <EmptyState icon="cycle" message={m.cycles.none} action={rotateButton} />
        ) : (
          <ClosedArchive cycles={closed} teamKey={team.key} />
        )}
      </div>
    );
  }

  const idx = all.findIndex((c) => c.id === selected.id);
  const history = data?.teamVelocity.history ?? [];
  const addedAfterStartIds = new Set(selected.addedAfterStartIssueIds);
  const header = (
    <CycleHeader
      cycle={selected}
      teamKey={team.key}
      prev={all[idx - 1] ?? null}
      next={all[idx + 1] ?? null}
      active={active}
      velocity={history}
      average={data?.teamVelocity.points ?? 0}
      onClose={() => setConfirmClose(true)}
    />
  );

  return (
    <>
      <ListScreen
        listId={`team-cycle-${selected.id}`}
        title={m.team.cyclesTitle}
        icon={<TeamIcon team={team} />}
        scope={{ teamId: team.id, cycleId: selected.id }}
        defaults={defaults}
        context={{ teamId: team.id, cycleId: selected.closedAt ? undefined : selected.id }}
        hiddenFilterFields={['team', 'cycle']}
        addedAfterStartIds={addedAfterStartIds}
        headerExtra={viewTabs}
        actions={rotateButton}
        subheader={header}
        empty={
          <EmptyState
            icon="cycle"
            message={m.cycles.emptyCycle}
            action={
              <Button variant="primary" onClick={() => openCreate({ teamId: team.id, cycleId: selected.id })}>
                {m.issue.createIssue}
              </Button>
            }
          />
        }
      />
      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        loading={closing}
        onConfirm={async () => {
          const res = await closeCycle({ id: selected.id });
          setConfirmClose(false);
          if (res.data) {
            showFlag({ title: m.cycles.closed_(selected.name), severity: 'success' });
            navigate(`/team/${team.key}/cycles`);
          }
        }}
        title={m.cycles.closeConfirm}
        description={m.cycles.closeBody}
        confirmLabel={m.cycles.closeEarly}
      />
    </>
  );
}
