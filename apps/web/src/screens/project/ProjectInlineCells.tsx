import { useMemo } from 'react';
import type { ReactNode, Ref } from 'react';
import { PopupSelect } from '@velocity/ui';
import type { PopupOption, PopupSelectTriggerProps } from '@velocity/ui';
import { useWorkspace } from '@/app/workspace';
import { HealthBadge, LeadCell, NONE, ProjectStatusIcon, healthLabel, healthOptions, leadOptions, statusLabel, statusOptions, useUpdateProject } from './projectUi';
import type { ProjectRecord } from './projectUi';
import { m } from '@/i18n';

/**
 * In-place editors for the projects table: each cell is its own picker trigger. Clicks
 * stop at the cell so editing never opens the project; the popup's keys belong to the
 * listbox (the table only handles keys aimed at the row itself).
 */
function CellPicker({
  label,
  options,
  value,
  onChange,
  children,
  testId,
}: {
  label: string;
  options: PopupOption[];
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <span className="flex max-w-full items-center" onClick={(e) => e.stopPropagation()}>
      <PopupSelect
        label={label}
        options={options}
        value={value}
        onChange={onChange}
        renderTrigger={(t: PopupSelectTriggerProps) => (
          <button
            type="button"
            ref={t.ref as Ref<HTMLButtonElement>}
            onClick={t.onClick}
            onKeyDown={t.onKeyDown}
            aria-haspopup="listbox"
            aria-expanded={t.open}
            aria-label={label}
            data-testid={testId}
            className="-mx-1.5 inline-flex h-7 min-w-0 max-w-full items-center rounded-sm px-1.5 transition-colors duration-100 hover:bg-neutral-hover active:bg-pressed"
          >
            {children}
          </button>
        )}
      />
    </span>
  );
}

export function ProjectStatusCell({ project }: { project: ProjectRecord }) {
  const save = useUpdateProject(project);
  return (
    <CellPicker
      label={`${m.project.status}: ${statusLabel(project.status)}`}
      options={statusOptions()}
      value={project.status}
      onChange={(v) => void save({ status: v as ProjectRecord['status'] })}
      testId="project-cell-status"
    >
      <span className="flex items-center gap-2">
        <ProjectStatusIcon status={project.status} percent={project.progress.percent} />
        <span className="text-base font-medium tabular-nums text-fg">{Math.round(project.progress.percent)}%</span>
      </span>
    </CellPicker>
  );
}

export function ProjectHealthCell({ project }: { project: ProjectRecord }) {
  const save = useUpdateProject(project);
  return (
    <CellPicker
      label={`${m.project.health}: ${project.health ? healthLabel(project.health) : m.project.noHealth}`}
      options={healthOptions()}
      value={project.health ?? NONE}
      onChange={(v) => void save({ health: v === NONE ? null : (v as ProjectRecord['health']) })}
      testId="project-cell-health"
    >
      <HealthBadge health={project.health} />
    </CellPicker>
  );
}

export function ProjectLeadCell({ project }: { project: ProjectRecord }) {
  const ws = useWorkspace();
  const save = useUpdateProject(project);
  const options = useMemo(() => leadOptions(ws), [ws]);
  return (
    <CellPicker
      label={`${m.project.lead}: ${project.lead?.name ?? m.project.noLead}`}
      options={options}
      value={project.leadId ?? NONE}
      onChange={(v) => void save({ leadId: v === NONE ? null : v })}
      testId="project-cell-lead"
    >
      <LeadCell lead={project.lead} />
    </CellPicker>
  );
}
