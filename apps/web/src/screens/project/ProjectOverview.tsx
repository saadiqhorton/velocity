import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Icon, Lozenge, PopupSelect, ProgressBar, StatusDot, TextField } from '@velocity/ui';
import type { ProjectInput } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { LazyEditor } from '@/components/editor/LazyEditor';
import { PropertyButton } from '@/components/issues/pickers';
import { ColorDot } from '@/components/common/EntityIcons';
import { formatShortDate } from '@/lib/format';
import { sortMilestones } from './ProjectMilestones';
import type { Milestone } from './ProjectMilestones';
import {
  NONE,
  PropertyRow,
  healthColor,
  healthLabel,
  healthOptions,
  leadOptions,
  statusAppearance,
  statusLabel,
  statusOptions,
  teamOptions,
} from './projectUi';
import type { ProjectRecord } from './projectUi';
import { m } from '@/i18n';

/** Inline name with 500ms debounced autosave (blank names are never saved). */
function NameEditor({ project, save }: { project: ProjectRecord; save: (i: ProjectInput) => void }) {
  const [value, setValue] = useState(project.name);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(project.name);
  useEffect(() => {
    if (!editing.current) {
      setValue(project.name);
      last.current = project.name;
    }
  }, [project.name]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const flush = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = v.trim();
    if (!next || next === last.current) return;
    last.current = next;
    save({ name: next });
  };
  return (
    <input
      aria-label={m.project.name}
      value={value}
      data-testid="project-name-input"
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(e) => {
        setValue(e.target.value);
        if (timer.current) clearTimeout(timer.current);
        const v = e.target.value;
        timer.current = setTimeout(() => flush(v), 500);
      }}
      onBlur={() => {
        editing.current = false;
        flush(value);
        if (!value.trim()) setValue(project.name);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setValue(project.name);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="h-10 w-full rounded-sm bg-transparent px-1 text-xl font-semibold text-fg hover:bg-hover focus:bg-hover"
    />
  );
}

function DescriptionEditor({ project, save }: { project: ProjectRecord; save: (i: ProjectInput) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(project.descriptionMd);
  const flush = (md: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (md === last.current) return;
    last.current = md;
    save({ descriptionMd: md });
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="rounded-sm px-1" data-testid="project-description">
      <LazyEditor
        key={project.id}
        value={project.descriptionMd}
        ariaLabel={m.common.description}
        placeholder={m.project.descriptionPlaceholder}
        onChange={(md) => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(md), 500);
        }}
        onBlur={flush}
        onEscape={() => (document.activeElement as HTMLElement | null)?.blur()}
      />
    </div>
  );
}

function Properties({ project, save }: { project: ProjectRecord; save: (i: ProjectInput) => void }) {
  const ws = useWorkspace();
  const leads = useMemo(() => leadOptions(ws), [ws]);
  const teams = useMemo(() => teamOptions(ws), [ws]);
  const triggerProps = (t: { ref: unknown; onClick: never; onKeyDown: never; open: boolean }) => ({
    ref: t.ref as never,
    onClick: t.onClick,
    onKeyDown: t.onKeyDown,
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': t.open,
  });
  return (
    <div className="flex flex-col gap-0.5" data-testid="project-properties">
      <PropertyRow label={m.project.status}>
        <PopupSelect
          label={m.project.status}
          options={statusOptions()}
          value={project.status}
          onChange={(v) => save({ status: v as ProjectRecord['status'] })}
          renderTrigger={(t) => (
            <PropertyButton {...triggerProps(t as never)} aria-label={`${m.project.status}: ${statusLabel(project.status)}`} testId="prop-project-status">
              <Lozenge appearance={statusAppearance(project.status)}>{statusLabel(project.status)}</Lozenge>
            </PropertyButton>
          )}
        />
      </PropertyRow>
      <PropertyRow label={m.project.health}>
        <PopupSelect
          label={m.project.health}
          options={healthOptions()}
          value={project.health ?? NONE}
          searchable={false}
          onChange={(v) => save({ health: v === NONE ? null : (v as ProjectRecord['health']) })}
          renderTrigger={(t) => (
            <PropertyButton
              {...triggerProps(t as never)}
              aria-label={`${m.project.health}: ${project.health ? healthLabel(project.health) : m.project.noHealth}`}
              muted={!project.health}
              icon={<ColorDot color={project.health ? healthColor(project.health) : 'grey'} size={8} />}
              testId="prop-project-health"
            >
              {project.health ? healthLabel(project.health) : m.project.noHealth}
            </PropertyButton>
          )}
        />
      </PropertyRow>
      <PropertyRow label={m.project.lead}>
        <PopupSelect
          label={m.project.lead}
          options={leads}
          value={project.leadId ?? NONE}
          onChange={(v) => save({ leadId: v === NONE ? null : v })}
          renderTrigger={(t) => (
            <PropertyButton
              {...triggerProps(t as never)}
              aria-label={`${m.project.lead}: ${project.lead?.name ?? m.project.noLead}`}
              muted={!project.lead}
              icon={project.lead ? <Avatar name={project.lead.name} src={project.lead.avatarUrl} size={16} /> : <Icon name="user" />}
              testId="prop-project-lead"
            >
              {project.lead?.name ?? m.project.noLead}
            </PropertyButton>
          )}
        />
      </PropertyRow>
      <PropertyRow label={m.project.targetDate}>
        <div className="flex items-center gap-1 pl-1">
          <TextField
            size="sm"
            type="date"
            aria-label={m.project.targetDate}
            value={project.targetDate ?? ''}
            onChange={(e) => save({ targetDate: e.target.value || null })}
            data-testid="prop-project-target"
            className="w-36"
          />
        </div>
      </PropertyRow>
      <PropertyRow label={m.project.teams}>
        <PopupSelect
          label={m.project.teams}
          multiple
          options={teams}
          value={project.teams.map((t) => t.id)}
          onChange={(ids: string[]) => save({ teamIds: ids })}
          renderTrigger={(t) => (
            <PropertyButton
              {...triggerProps(t as never)}
              aria-label={`${m.project.teams}: ${project.teams.map((x) => x.name).join(', ') || m.project.noTeams}`}
              muted={project.teams.length === 0}
              icon={<Icon name="team" />}
              testId="prop-project-teams"
            >
              {project.teams.length ? project.teams.map((x) => x.key).join(', ') : m.project.noTeams}
            </PropertyButton>
          )}
        />
      </PropertyRow>
    </div>
  );
}

export function ProjectOverview({ project, milestones, save }: { project: ProjectRecord; milestones: Milestone[]; save: (i: ProjectInput) => void }) {
  const sorted = sortMilestones(milestones);
  const shown = sorted.slice(0, 4);
  const p = project.progress;
  return (
    <div className="mx-auto flex w-full max-w-240 flex-col gap-8 p-5 md:flex-row" data-testid="project-overview">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <NameEditor project={project} save={save} />
        <DescriptionEditor project={project} save={save} />
        <section aria-label={m.project.milestones} className="flex flex-col gap-2 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">{m.project.milestones}</h2>
            <Link to={`/project/${project.id}/milestones`} className="rounded-sm px-1 text-sm text-link hover:bg-hover">
              {m.project.viewAll}
            </Link>
          </div>
          {shown.length === 0 ? (
            <p className="text-base text-fg-subtle">{m.project.noMilestones}</p>
          ) : (
            <ul className="rounded-md border border-border bg-raised">
              {shown.map((x) => (
                <li key={x.id} className="flex h-10 items-center gap-3 border-b border-border px-3 last:border-b-0">
                  <StatusDot color={x.status === 'done' ? 'green' : x.status === 'in_progress' ? 'blue' : 'grey'} label={(m.project.milestoneStatuses as Record<string, string>)[x.status]} />
                  <span className="min-w-0 flex-1 truncate text-base text-fg">{x.name}</span>
                  <span className="w-16 shrink-0 text-sm text-fg-subtle">{x.targetDate ? formatShortDate(x.targetDate) : ''}</span>
                  <span className="w-24 shrink-0">
                    <ProgressBar value={x.progress.percent} label={`${m.project.progress}: ${x.name}`} />
                  </span>
                  <span className="w-8 shrink-0 text-right text-sm tabular-nums text-fg-subtle">{Math.round(x.progress.percent)}%</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <aside className="flex min-w-0 flex-col gap-6 md:w-72 md:shrink-0" aria-label={m.project.properties}>
        <section className="flex flex-col gap-1">
          <h2 className="px-2 text-sm font-semibold text-fg-subtle">{m.project.properties}</h2>
          <Properties project={project} save={save} />
        </section>
        <section className="flex flex-col gap-2 px-2" aria-label={m.project.progress}>
          <h2 className="text-sm font-semibold text-fg-subtle">{m.project.progress}</h2>
          <ProgressBar value={p.percent} label={m.project.progress} showPercent />
          <p className="text-sm text-fg-subtle" data-testid="project-progress-count">
            {m.cycles.stats(p.done, p.total)}
          </p>
          {p.pointsTotal > 0 ? <p className="text-sm text-fg-subtle">{m.cycles.points(p.pointsDone, p.pointsTotal)}</p> : null}
        </section>
      </aside>
    </div>
  );
}
