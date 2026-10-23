import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Avatar, Icon, PopupSelect, ProgressBar, TextField } from '@velocity/ui';
import type { ProjectInput } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { LazyEditor } from '@/components/editor/LazyEditor';
import { PropertyButton } from '@/components/issues/pickers';
import { ColorDot, ProjectIcon } from '@/components/common/EntityIcons';
import { sortMilestones } from './ProjectMilestones';
import type { Milestone } from './ProjectMilestones';
import { ProjectSummaryChips } from './ProjectSummaryChips';
import { ProjectOverviewMilestones } from './ProjectOverviewMilestones';
import {
  MilestoneIcon,
  milestoneIssuesHref,
  NONE,
  ProjectStatusIcon,
  PropertyRow,
  healthColor,
  healthLabel,
  healthOptions,
  leadOptions,
  statusLabel,
  statusOptions,
  teamOptions,
} from './projectUi';
import type { ProjectRecord } from './projectUi';
import { useFeatures } from '@/lib/features';
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
      className="-mx-1 h-10 w-[calc(100%+8px)] rounded-sm bg-transparent px-1 text-2xl font-semibold tracking-tight text-fg transition-colors duration-100 hover:bg-hover focus:bg-hover"
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
    <div className="-mx-1 rounded-sm px-1" data-testid="project-description">
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
            <PropertyButton
              {...triggerProps(t as never)}
              aria-label={`${m.project.status}: ${statusLabel(project.status)}`}
              icon={<ProjectStatusIcon status={project.status} percent={project.progress.percent} />}
              testId="prop-project-status"
            >
              {statusLabel(project.status)}
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
        <div className="flex items-center gap-1">
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

/** A rail card with a collapsible heading (Properties, Milestones, Progress). */
function RailCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label={title} className="rounded-md border border-border bg-raised">
      <div className="flex h-10 items-center gap-1 pl-2 pr-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-label={m.project.toggleSection(title)}
          onClick={() => setOpen(!open)}
          className="flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-base font-medium text-fg-subtle transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          {title}
          <Icon name="chevron-down" className={clsx('h-3 w-3 transition-transform duration-150', !open && '-rotate-90')} />
        </button>
        <span className="flex-1" />
        {action}
      </div>
      {open ? <div className="px-2 pb-2">{children}</div> : null}
    </section>
  );
}

export function ProjectOverview({ project, milestones, save }: { project: ProjectRecord; milestones: Milestone[]; save: (i: ProjectInput) => void }) {
  const sorted = sortMilestones(milestones);
  const p = project.progress;
  const estimates = useFeatures().estimates;
  const milestonesHref = `/project/${project.id}/milestones`;
  return (
    <div className="flex w-full flex-col gap-6 px-5 py-8 lg:flex-row lg:items-start lg:gap-8 lg:pr-4 lg:pl-8" data-testid="project-overview">
      <div className="mx-auto flex w-full min-w-0 max-w-190 flex-1 flex-col gap-5">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-md"
          style={{ backgroundColor: `var(--ds-status-${project.color}-bg)` }}
        >
          <ProjectIcon project={project} size={20} />
        </span>
        <div className="flex flex-col gap-3">
          <NameEditor project={project} save={save} />
          <ProjectSummaryChips project={project} save={save} />
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-6">
          <h2 className="text-base font-medium text-fg-subtle">{m.common.description}</h2>
          <DescriptionEditor project={project} save={save} />
        </div>
        <ProjectOverviewMilestones projectId={project.id} milestones={milestones} />
      </div>
      <aside className="flex w-full min-w-0 flex-col gap-3 lg:sticky lg:top-0 lg:w-90 lg:shrink-0" aria-label={m.project.properties}>
        <RailCard title={m.project.properties}>
          <Properties project={project} save={save} />
        </RailCard>
        <RailCard
          title={m.project.milestones}
          action={
            <Link
              to={milestonesHref}
              aria-label={m.project.addMilestone}
              className="flex h-7 w-7 items-center justify-center rounded-sm text-icon-subtle transition-colors duration-100 hover:bg-hover hover:text-icon"
            >
              <Icon name="add" />
            </Link>
          }
        >
          {sorted.length === 0 ? (
            <p className="px-2 pb-1 text-base text-fg-subtlest">{m.project.noMilestones}</p>
          ) : (
            <ul className="flex flex-col">
              {sorted.map((x) => (
                <li key={x.id}>
                  <Link
                    to={milestoneIssuesHref(project.id, x.id)}
                    aria-label={m.project.viewMilestoneIssues(x.name)}
                    className="flex h-8 items-center gap-2.5 rounded-sm px-2 transition-colors duration-100 hover:bg-hover"
                  >
                    <MilestoneIcon status={x.status} percent={x.progress.percent} />
                    <span className="min-w-0 flex-1 truncate text-base font-medium text-fg">{x.name}</span>
                    <span className="shrink-0 text-sm tabular-nums text-fg-subtle">
                      {m.project.milestoneProgress(Math.round(x.progress.percent), x.progress.total)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </RailCard>
        <RailCard title={m.project.progress}>
          <div className="flex flex-col gap-3 px-2 pb-1" aria-label={m.project.progress}>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-sm text-fg-subtle">
                  <span aria-hidden="true" className="h-2 w-2 rounded-xs bg-neutral-hover" />
                  {m.project.progressScope}
                </span>
                <span className="text-md font-medium tabular-nums text-fg">{p.total}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-sm text-fg-subtle">
                  <span aria-hidden="true" className="h-2 w-2 rounded-xs bg-primary" />
                  {m.project.progressCompleted}
                </span>
                <span className="text-md font-medium tabular-nums text-fg">
                  {p.done} <span className="text-sm font-normal text-fg-subtlest">· {Math.round(p.percent)}%</span>
                </span>
              </div>
            </div>
            <ProgressBar value={p.percent} label={m.project.progress} />
            <p className="text-sm text-fg-subtle" data-testid="project-progress-count">
              {m.cycles.stats(p.done, p.total)}
            </p>
            {estimates && p.pointsTotal > 0 ? <p className="text-sm text-fg-subtle">{m.cycles.points(p.pointsDone, p.pointsTotal)}</p> : null}
          </div>
        </RailCard>
      </aside>
    </div>
  );
}
