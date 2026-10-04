import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@apollo/client';
import { Avatar, Button, Icon, Modal, PopupSelect, PriorityIcon, StatusIcon, Switch, useFlags } from '@velocity/ui';
import type { PopupOption } from '@velocity/ui';
import { TeamCyclesDocument } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useUi } from '@/stores/ui';
import { useOpenIssue } from '@/lib/navigation';
import { LazyEditor } from '@/components/editor/LazyEditor';
import type { MarkdownEditorHandle } from '@/components/editor/LazyEditor';
import { ColorDot, ProjectIcon, TeamIcon } from '@/components/common/EntityIcons';
import { defaultStatusFor, useCreateIssue } from '@/components/issues/actions';
import {
  NONE,
  assigneeOptions,
  cycleOptions,
  estimateLabel,
  estimateOptions,
  labelOptions,
  priorityOptions,
  projectOptions,
  statusOptions,
  teamOptions,
} from '@/components/issues/pickers';
import { PRIORITY_KEYS } from '@/components/issues/IssueRow';
import { m } from '@/i18n';

interface ChipPickerProps {
  label: string;
  options: PopupOption[];
  value: string | null;
  onChange: (v: string) => void;
  icon: ReactNode;
  text: string;
  testId: string;
}

function ChipPicker({ label, options, value, onChange, icon, text, testId }: ChipPickerProps) {
  return (
    <PopupSelect
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      renderTrigger={(t) => (
        <button
          type="button"
          ref={t.ref as never}
          onClick={t.onClick}
          onKeyDown={t.onKeyDown}
          aria-haspopup="listbox"
          aria-expanded={t.open}
          aria-label={`${label}: ${text}`}
          data-testid={testId}
          className="inline-flex h-7 max-w-48 items-center gap-1.5 rounded-sm border border-border px-2 text-sm text-fg transition-colors duration-100 hover:bg-hover"
        >
          <span className="flex w-4 shrink-0 justify-center">{icon}</span>
          <span className="truncate">{text}</span>
        </button>
      )}
    />
  );
}

/** Create issue (SPEC §3.5.1, §4.9.8): title + team; every property inline; Enter submits. */
export function CreateIssueModal() {
  const ws = useWorkspace();
  const defaults = useUi((s) => s.createDefaults);
  const close = useUi((s) => s.closeCreate);
  const { showFlag } = useFlags();
  const openIssue = useOpenIssue();
  const [create] = useCreateIssue();
  const editor = useRef<MarkdownEditorHandle>(null);

  const initialTeam = (defaults.teamId && ws.teamsById.get(defaults.teamId)) || ws.teams[0];
  const [teamId, setTeamId] = useState(initialTeam?.id ?? '');
  const team = ws.teamsById.get(teamId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [statusId, setStatusId] = useState<string | null>(defaults.statusId ?? (team ? defaultStatusFor(team) : null));
  const [priority, setPriority] = useState<number>(defaults.priority ?? 2);
  const [assigneeId, setAssigneeId] = useState<string | null>(defaults.assigneeId ?? null);
  const [labelIds, setLabelIds] = useState<string[]>(defaults.labelIds ?? []);
  const [projectId, setProjectId] = useState<string | null>(defaults.projectId ?? null);
  const [cycleId, setCycleId] = useState<string | null>(defaults.cycleId ?? null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cyclesQ = useQuery(TeamCyclesDocument, { variables: { teamId, includeClosed: false, first: 6 }, skip: !team?.cycleEnabled });

  const status = team?.statuses.find((s) => s.id === statusId) ?? null;
  const assignee = assigneeId ? ws.usersById.get(assigneeId) : undefined;
  const project = projectId ? ws.projectsById.get(projectId) : undefined;
  const cycle = cyclesQ.data?.cycles.find((c) => c.id === cycleId);
  const labels = useMemo(() => labelIds.map((id) => ws.labelsById.get(id)).filter((l) => l !== undefined), [labelIds, ws.labelsById]);
  const dirty = title.trim() !== '' || description.trim() !== '';

  const submit = () => {
    const t = title.trim();
    if (!t) {
      setError(m.issue.title);
      return;
    }
    if (!team) return;
    const input = {
      title: t,
      teamId: team.id,
      descriptionMd: description || undefined,
      statusId: statusId ?? undefined,
      priority,
      assigneeId: assigneeId ?? undefined,
      labelIds,
      projectId: projectId ?? undefined,
      cycleId: cycleId ?? undefined,
      estimate: estimate ?? undefined,
      parentId: defaults.parentId ?? undefined,
      milestoneId: defaults.milestoneId ?? undefined,
    };
    void create(input).then((res) => {
      const issue = res.data?.createIssue;
      if (issue) {
        showFlag({
          title: m.issue.created(issue.identifier),
          severity: 'success',
          action: { label: m.common.open, onClick: () => openIssue(issue.id) },
        });
      }
    });
    if (more) {
      setTitle('');
      setDescription('');
      editor.current?.clear();
      document.getElementById('create-issue-title')?.focus();
    } else {
      close();
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={m.issue.newIssue}
      size="lg"
      isDirty={dirty}
      onSubmit={submit}
      footer={
        <div className="flex w-full items-center gap-3">
          <Switch label={m.issue.createMore} checked={more} onChange={setMore} />
          <span className="flex-1" />
          <Button onClick={close}>{m.common.cancel}</Button>
          <Button variant="primary" onClick={submit} data-testid="create-issue-submit">
            {m.issue.createIssue}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3" data-testid="create-issue-modal">
        <div className="flex items-center gap-2">
          <ChipPicker
            label={m.issue.team}
            testId="create-team"
            options={teamOptions(ws)}
            value={teamId}
            onChange={(v) => {
              setTeamId(v);
              const t = ws.teamsById.get(v);
              setStatusId(t ? defaultStatusFor(t) : null);
              setCycleId(null);
            }}
            icon={team ? <TeamIcon team={team} /> : null}
            text={team?.key ?? ''}
          />
        </div>
        <input
          id="create-issue-title"
          data-autofocus
          aria-label={m.issue.title}
          aria-invalid={error ? true : undefined}
          placeholder={m.issue.titlePlaceholder}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          className="w-full border-b border-transparent bg-transparent pb-1 text-xl font-semibold text-fg placeholder:text-fg-subtlest focus-visible:border-primary focus-visible:outline-none"
          data-testid="create-issue-title"
          autoComplete="off"
        />
        <div className="min-h-24">
          <LazyEditor handle={editor} value="" ariaLabel={m.common.description} placeholder={m.issue.descriptionPlaceholder} onChange={setDescription} onSubmit={submit} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          {team ? (
            <ChipPicker
              label={m.issue.status}
              testId="create-status"
              options={statusOptions(team)}
              value={statusId}
              onChange={setStatusId}
              icon={status ? <StatusIcon category={status.category} color={status.color} label="" /> : null}
              text={status?.name ?? m.issue.status}
            />
          ) : null}
          <ChipPicker
            label={m.issue.priority}
            testId="create-priority"
            options={priorityOptions()}
            value={String(priority)}
            onChange={(v) => setPriority(Number(v))}
            icon={<PriorityIcon priority={PRIORITY_KEYS[priority] ?? 'none'} />}
            text={m.priority[priority as 0 | 1 | 2 | 3 | 4]}
          />
          <ChipPicker
            label={m.issue.assignee}
            testId="create-assignee"
            options={assigneeOptions(ws)}
            value={assigneeId ?? NONE}
            onChange={(v) => setAssigneeId(v === NONE ? null : v)}
            icon={assignee ? <Avatar name={assignee.name} src={assignee.avatarUrl} size={16} /> : <Icon name="user" />}
            text={assignee?.name ?? m.issue.assignee}
          />
          <PopupSelect
            label={m.issue.labels}
            options={labelOptions(ws)}
            multiple
            value={labelIds}
            onChange={setLabelIds}
            renderTrigger={(t) => (
              <button
                type="button"
                ref={t.ref as never}
                onClick={t.onClick}
                onKeyDown={t.onKeyDown}
                aria-haspopup="listbox"
                aria-expanded={t.open}
                data-testid="create-labels"
                className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border px-2 text-sm text-fg transition-colors duration-100 hover:bg-hover"
              >
                {labels.length === 0 ? (
                  <>
                    <Icon name="label" />
                    {m.issue.labels}
                  </>
                ) : (
                  labels.map((l) => (
                    <span key={l.id} className="inline-flex items-center gap-1">
                      <ColorDot color={l.color} size={6} />
                      {l.name}
                    </span>
                  ))
                )}
              </button>
            )}
          />
          <ChipPicker
            label={m.issue.project}
            testId="create-project"
            options={projectOptions(ws)}
            value={projectId ?? NONE}
            onChange={(v) => setProjectId(v === NONE ? null : v)}
            icon={project ? <ProjectIcon project={project} /> : <Icon name="project" />}
            text={project?.name ?? m.issue.project}
          />
          {team?.cycleEnabled ? (
            <ChipPicker
              label={m.issue.cycle}
              testId="create-cycle"
              options={cycleOptions(cyclesQ.data?.cycles ?? [])}
              value={cycleId ?? NONE}
              onChange={(v) => setCycleId(v === NONE ? null : v)}
              icon={<Icon name="cycle" />}
              text={cycle?.name ?? m.issue.cycle}
            />
          ) : null}
          <ChipPicker
            label={m.issue.estimate}
            testId="create-estimate"
            options={estimateOptions(team?.estimateScale)}
            value={estimate === null ? NONE : String(estimate)}
            onChange={(v) => setEstimate(v === NONE ? null : Number(v))}
            icon={<Icon name="chart" />}
            text={estimate === null ? m.issue.estimate : estimateLabel(team?.estimateScale, estimate)}
          />
        </div>
      </div>
    </Modal>
  );
}
