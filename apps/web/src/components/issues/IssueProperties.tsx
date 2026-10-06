import type { ReactNode } from 'react';
import { useQuery } from '@apollo/client';
import clsx from 'clsx';
import { Avatar, Icon, PopupSelect, PriorityIcon, StatusIcon } from '@velocity/ui';
import type { PopupOption } from '@velocity/ui';
import { ProjectDetailDocument, TeamCyclesDocument } from '@/gql/graphql';
import type { IssueDetailQuery, UpdateIssueInput } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { teamUsesCycles, useFeatures } from '@/lib/features';
import { ColorDot, ProjectIcon } from '@/components/common/EntityIcons';
import { useUpdateIssues } from './actions';
import {
  NONE,
  PropertyButton,
  assigneeOptions,
  cycleOptions,
  estimateLabel,
  estimateOptions,
  labelOptions,
  priorityOptions,
  projectOptions,
  statusOptions,
} from './pickers';
import { PRIORITY_KEYS } from './IssueRow';
import { m } from '@/i18n';

type Issue = NonNullable<IssueDetailQuery['issue']>;

interface RowProps {
  label: string;
  children: ReactNode;
  layout: 'stacked' | 'inline';
}

function PropertyRow({ label, children, layout, hideLabel }: RowProps & { hideLabel?: boolean }) {
  return (
    <div className={clsx('flex min-w-0', layout === 'inline' ? 'items-center gap-2' : 'flex-col gap-0.5')}>
      <span className={clsx('shrink-0 text-sm text-fg-subtlest', hideLabel ? 'sr-only' : layout === 'inline' ? 'w-24 pl-2' : 'pl-2')}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

interface PickerFieldProps {
  label: string;
  options: PopupOption[];
  value: string | null;
  onChange: (value: string) => void;
  icon: ReactNode;
  text: string;
  muted?: boolean;
  testId: string;
}

function PickerField({ label, options, value, onChange, icon, text, muted, testId }: PickerFieldProps) {
  return (
    <PopupSelect
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      renderTrigger={(t) => (
        <PropertyButton
          ref={t.ref as never}
          onClick={t.onClick}
          onKeyDown={t.onKeyDown}
          aria-haspopup="listbox"
          aria-expanded={t.open}
          aria-label={`${label}: ${text}`}
          icon={icon}
          muted={muted}
          testId={testId}
        >
          {text}
        </PropertyButton>
      )}
    />
  );
}

function Group({ title, grouped, children }: { title: string; grouped: boolean; children: ReactNode }) {
  if (!grouped) return <>{children}</>;
  return (
    <section className="flex flex-col gap-0.5 border-b border-border pb-3 last:border-b-0 last:pb-0" aria-label={title}>
      <h2 className="flex h-7 items-center px-2 text-sm font-semibold text-fg-subtle">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Properties block (SPEC §4.11.3): popup-select inline editors, never modals. `grouped` is
 * the issue page sidebar (U1): Properties, Labels, Project and Planning sections. Cycle and
 * estimate show only when those features are on (U4).
 */
export function IssueProperties({ issue, layout = 'inline', grouped = false }: { issue: Issue; layout?: 'stacked' | 'inline'; grouped?: boolean }) {
  const ws = useWorkspace();
  const features = useFeatures();
  const cyclesOn = teamUsesCycles(features, ws.teamsById.get(issue.teamId));
  const update = useUpdateIssues();
  const team = ws.teamsById.get(issue.teamId);
  const cyclesQ = useQuery(TeamCyclesDocument, {
    variables: { teamId: issue.teamId, includeClosed: false, first: 6 },
    skip: !cyclesOn,
    fetchPolicy: 'cache-first',
  });
  const projectQ = useQuery(ProjectDetailDocument, { variables: { id: issue.projectId ?? '' }, skip: !issue.projectId, fetchPolicy: 'cache-first' });
  const set = (input: UpdateIssueInput) => void update([issue.id], input);
  const priorityKey = PRIORITY_KEYS[issue.priority] ?? 'none';
  const project = issue.projectId ? ws.projectsById.get(issue.projectId) : undefined;
  const milestones = projectQ.data?.project?.milestones ?? [];

  return (
    <div className={clsx('flex flex-col', grouped ? 'gap-3' : 'gap-0.5')} data-testid="issue-properties">
      <Group title={m.issuePage.properties} grouped={grouped}>
        <PropertyRow label={m.issue.status} layout={layout}>
          <PickerField
            label={m.issue.status}
            testId="prop-status"
            options={team ? statusOptions(team) : []}
            value={issue.statusId}
            onChange={(v) => set({ statusId: v })}
            icon={<StatusIcon category={issue.status.category} color={issue.status.color} label="" />}
            text={issue.status.name}
          />
        </PropertyRow>
        <PropertyRow label={m.issue.priority} layout={layout}>
          <PickerField
            label={m.issue.priority}
            testId="prop-priority"
            options={priorityOptions()}
            value={String(issue.priority)}
            onChange={(v) => set({ priority: Number(v) })}
            icon={<PriorityIcon priority={priorityKey} />}
            text={m.priority[issue.priority as 0 | 1 | 2 | 3 | 4]}
            muted={issue.priority === 4}
          />
        </PropertyRow>
        <PropertyRow label={m.issue.assignee} layout={layout}>
          <PickerField
            label={m.issue.assignee}
            testId="prop-assignee"
            options={assigneeOptions(ws)}
            value={issue.assigneeId ?? NONE}
            onChange={(v) => set({ assigneeId: v === NONE ? null : v })}
            icon={issue.assignee ? <Avatar name={issue.assignee.name} src={issue.assignee.avatarUrl} size={16} /> : <Icon name="user" />}
            text={issue.assignee?.name ?? m.issue.noAssignee}
            muted={!issue.assignee}
          />
        </PropertyRow>
      </Group>
      <Group title={m.issuePage.labels} grouped={grouped}>
        <PropertyRow label={m.issue.labels} layout={layout} hideLabel={grouped}>
          <PopupSelect
            label={m.issue.labels}
            options={labelOptions(ws)}
            multiple
            value={issue.labelIds}
            onChange={(ids: string[]) => set({ labelIds: ids })}
            renderTrigger={(t) => (
              <button
                type="button"
                ref={t.ref as never}
                onClick={t.onClick}
                onKeyDown={t.onKeyDown}
                aria-haspopup="listbox"
                aria-expanded={t.open}
                data-testid="prop-labels"
                aria-label={m.issue.labels}
                className="flex min-h-7 w-full min-w-0 flex-wrap items-center gap-1 rounded-sm px-2 py-0.5 text-left text-base transition-colors duration-100 hover:bg-hover"
              >
                {issue.labels.length === 0 ? (
                  <span className="flex items-center gap-2 text-fg-subtlest">
                    <Icon name="label" />
                    {m.issue.addLabel}
                  </span>
                ) : (
                  issue.labels.map((l) => (
                    <span key={l.id} className="inline-flex h-5 items-center gap-1 rounded-sm border border-border px-1.5 text-sm text-fg">
                      <ColorDot color={l.color} size={6} />
                      {l.name}
                    </span>
                  ))
                )}
              </button>
            )}
          />
        </PropertyRow>
      </Group>
      <Group title={m.issuePage.project} grouped={grouped}>
        <PropertyRow label={m.issue.project} layout={layout}>
          <PickerField
            label={m.issue.project}
            testId="prop-project"
            options={projectOptions(ws)}
            value={issue.projectId ?? NONE}
            onChange={(v) => set({ projectId: v === NONE ? null : v, ...(v === NONE ? { milestoneId: null } : {}) })}
            icon={project ? <ProjectIcon project={project} /> : <Icon name="project" />}
            text={project?.name ?? issue.project?.name ?? m.issue.noProject}
            muted={!issue.projectId}
          />
        </PropertyRow>
        {issue.projectId && milestones.length > 0 ? (
          <PropertyRow label={m.issue.milestone} layout={layout}>
            <PickerField
              label={m.issue.milestone}
              testId="prop-milestone"
              options={[
                { value: NONE, label: m.issue.noMilestone },
                ...milestones.map((ms) => ({ value: ms.id, label: ms.name, icon: <Icon name="calendar" className="text-fg-subtle" /> })),
              ]}
              value={issue.milestoneId ?? NONE}
              onChange={(v) => set({ milestoneId: v === NONE ? null : v })}
              icon={<Icon name="calendar" />}
              text={issue.milestone?.name ?? m.issue.noMilestone}
              muted={!issue.milestoneId}
            />
          </PropertyRow>
        ) : null}
      </Group>
      {cyclesOn || features.estimates ? (
        <Group title={m.issuePage.planning} grouped={grouped}>
          {cyclesOn ? (
            <PropertyRow label={m.issue.cycle} layout={layout}>
              <PickerField
                label={m.issue.cycle}
                testId="prop-cycle"
                options={cycleOptions(cyclesQ.data?.cycles ?? [])}
                value={issue.cycleId ?? NONE}
                onChange={(v) => set({ cycleId: v === NONE ? null : v })}
                icon={<Icon name="cycle" />}
                text={issue.cycle?.name ?? m.issue.noCycle}
                muted={!issue.cycleId}
              />
            </PropertyRow>
          ) : null}
          {features.estimates ? (
            <PropertyRow label={m.issue.estimate} layout={layout}>
              <PickerField
                label={m.issue.estimate}
                testId="prop-estimate"
                options={estimateOptions(team?.estimateScale)}
                value={issue.estimate === null ? NONE : String(issue.estimate)}
                onChange={(v) => set({ estimate: v === NONE ? null : Number(v) })}
                icon={<Icon name="chart" />}
                text={estimateLabel(team?.estimateScale, issue.estimate)}
                muted={issue.estimate === null}
              />
            </PropertyRow>
          ) : null}
        </Group>
      ) : null}
    </div>
  );
}
