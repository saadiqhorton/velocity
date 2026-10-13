import { useMemo, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { Avatar, Icon, Popover, PopupSelect, TextField } from '@velocity/ui';
import type { PopupOption, PopupSelectTriggerProps } from '@velocity/ui';
import type { ProjectInput } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { PropertyButton } from '@/components/issues/pickers';
import { ColorDot, TeamIcon } from '@/components/common/EntityIcons';
import { formatShortDate } from '@/lib/format';
import {
  NONE,
  ProjectStatusIcon,
  healthColor,
  healthLabel,
  healthOptions,
  leadOptions,
  statusLabel,
  statusOptions,
  teamOptions,
} from './projectUi';
import type { ProjectRecord } from './projectUi';
import { m } from '@/i18n';

type Save = (input: ProjectInput) => void;

function triggerProps(t: PopupSelectTriggerProps) {
  return {
    ref: t.ref as Ref<HTMLButtonElement>,
    onClick: t.onClick,
    onKeyDown: t.onKeyDown,
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': t.open,
  };
}

interface ChipSelectBase {
  label: string;
  options: PopupOption[];
  icon: ReactNode;
  text: string;
  muted?: boolean;
  testId: string;
  searchable?: boolean;
}

function ChipSelect(
  props: ChipSelectBase & { multiple?: false; value: string; onChange: (v: string) => void },
): ReactNode;
function ChipSelect(
  props: ChipSelectBase & { multiple: true; value: string[]; onChange: (v: string[]) => void },
): ReactNode;
function ChipSelect({
  label,
  options,
  value,
  onChange,
  icon,
  text,
  muted,
  testId,
  multiple,
  searchable,
}: ChipSelectBase & {
  multiple?: boolean;
  value: string | string[];
  onChange: ((v: string) => void) | ((v: string[]) => void);
}) {
  const chipClass = '-mx-1 px-1.5';
  const trigger = (t: PopupSelectTriggerProps) => (
    <PropertyButton
      {...triggerProps(t)}
      aria-label={`${label}: ${text}`}
      icon={icon}
      muted={muted}
      testId={testId}
      className={chipClass}
    >
      {text}
    </PropertyButton>
  );
  if (multiple) {
    return (
      <PopupSelect
        label={label}
        multiple
        options={options}
        value={value as string[]}
        onChange={onChange as (v: string[]) => void}
        searchable={searchable}
        renderTrigger={trigger}
      />
    );
  }
  return (
    <PopupSelect
      label={label}
      options={options}
      value={value as string}
      onChange={onChange as (v: string) => void}
      searchable={searchable}
      renderTrigger={trigger}
    />
  );
}

function TargetDateChip({ project, save }: { project: ProjectRecord; save: Save }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const text = project.targetDate ? formatShortDate(project.targetDate) : m.project.noTarget;
  return (
    <>
      <PropertyButton
        ref={setAnchor}
        aria-label={`${m.project.targetDate}: ${text}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        muted={!project.targetDate}
        icon={<Icon name="calendar" className="h-3.5 w-3.5 text-icon-subtle" />}
        testId="summary-project-target"
        className="-mx-1 px-1.5"
        onClick={() => {
          setOpen(true);
          queueMicrotask(() => inputRef.current?.focus());
        }}
      >
        {text}
      </PropertyButton>
      <Popover open={open} anchorEl={anchor} onDismiss={() => setOpen(false)} placement="bottom-start" className="p-2">
        <TextField
          ref={inputRef}
          size="sm"
          type="date"
          aria-label={m.project.targetDate}
          value={project.targetDate ?? ''}
          onChange={(e) => {
            save({ targetDate: e.target.value || null });
            setOpen(false);
          }}
          data-testid="summary-project-target-input"
          className="w-40"
        />
      </Popover>
    </>
  );
}

/**
 * Editable property chips under the project title — same mutations as the Properties rail,
 * laid out as a horizontal summary (Linear-style overview).
 */
export function ProjectSummaryChips({ project, save }: { project: ProjectRecord; save: Save }) {
  const ws = useWorkspace();
  const leads = useMemo(() => leadOptions(ws), [ws]);
  const teams = useMemo(() => teamOptions(ws), [ws]);
  const teamLabel = project.teams.map((t) => t.name).join(', ') || m.project.noTeams;
  const teamIcon =
    project.teams.length === 1 && ws.teamsById.get(project.teams[0]!.id) ? (
      <TeamIcon team={ws.teamsById.get(project.teams[0]!.id)!} />
    ) : (
      <Icon name="team" />
    );

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="project-summary">
      <span className="w-20 shrink-0 text-base text-fg-subtle">{m.project.properties}</span>
      <ChipSelect
        label={m.project.status}
        options={statusOptions()}
        value={project.status}
        onChange={(v) => save({ status: v as ProjectRecord['status'] })}
        icon={<ProjectStatusIcon status={project.status} percent={project.progress.percent} />}
        text={statusLabel(project.status)}
        testId="summary-project-status"
      />
      <ChipSelect
        label={m.project.health}
        options={healthOptions()}
        value={project.health ?? NONE}
        searchable={false}
        onChange={(v) => save({ health: v === NONE ? null : (v as ProjectRecord['health']) })}
        icon={<ColorDot color={project.health ? healthColor(project.health) : 'grey'} size={8} />}
        text={project.health ? healthLabel(project.health) : m.project.noHealth}
        muted={!project.health}
        testId="summary-project-health"
      />
      <ChipSelect
        label={m.project.lead}
        options={leads}
        value={project.leadId ?? NONE}
        onChange={(v) => save({ leadId: v === NONE ? null : v })}
        icon={project.lead ? <Avatar name={project.lead.name} src={project.lead.avatarUrl} size={16} /> : <Icon name="user" />}
        text={project.lead?.name ?? m.project.noLead}
        muted={!project.lead}
        testId="summary-project-lead"
      />
      <TargetDateChip project={project} save={save} />
      <ChipSelect
        label={m.project.teams}
        multiple
        options={teams}
        value={project.teams.map((t) => t.id)}
        onChange={(ids) => save({ teamIds: ids })}
        icon={teamIcon}
        text={teamLabel}
        muted={project.teams.length === 0}
        testId="summary-project-teams"
      />
    </div>
  );
}
