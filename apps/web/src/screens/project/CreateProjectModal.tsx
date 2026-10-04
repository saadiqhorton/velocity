import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Avatar, Button, Field, Icon, Modal, PopupSelect, Select, TextArea, TextField } from '@velocity/ui';
import { CreateProjectDocument } from '@/gql/graphql';
import type { PaletteColor, ProjectStatus } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { PropertyButton } from '@/components/issues/pickers';
import { TeamIcon } from '@/components/common/EntityIcons';
import { useOptimisticMutation } from '@/lib/mutation';
import { describeError } from '@/lib/errors';
import { useFlags } from '@velocity/ui';
import { NONE, PROJECT_COLORS, PROJECT_STATUSES, leadOptions, statusLabel, teamOptions } from './projectUi';
import { m } from '@/i18n';

export interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  /** Teams preselected (team-scoped project list). */
  defaultTeamIds?: string[];
}

/** Create-project dialog (SPEC §3.9): name, icon, color, status, lead, target date, teams, description. */
export function CreateProjectModal({ open, onClose, defaultTeamIds = [] }: CreateProjectModalProps) {
  if (!open) return null;
  return <CreateProjectForm onClose={onClose} defaultTeamIds={defaultTeamIds} />;
}

function CreateProjectForm({ onClose, defaultTeamIds }: { onClose: () => void; defaultTeamIds: string[] }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { showFlag } = useFlags();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState<PaletteColor>('blue');
  const [status, setStatus] = useState<ProjectStatus>('planned');
  const [leadId, setLeadId] = useState<string>(NONE);
  const [targetDate, setTargetDate] = useState('');
  const [teamIds, setTeamIds] = useState<string[]>(defaultTeamIds);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [create, { loading }] = useOptimisticMutation(CreateProjectDocument, {
    optimistic: { serverConfirmed: 'The server mints the project id and its progress rollup' },
    rollback: () => m.project.rollback.create,
    refetchQueries: ['Projects', 'Bootstrap'],
    silent: true,
  });
  const leads = useMemo(() => leadOptions(ws), [ws]);
  const teams = useMemo(() => teamOptions(ws), [ws]);
  const lead = leadId === NONE ? null : ws.usersById.get(leadId);
  const nameError = touched && name.trim() === '' ? m.project.nameRequired : undefined;
  const dirty = name !== '' || description !== '' || icon !== '';

  const submit = async () => {
    setTouched(true);
    if (name.trim() === '' || loading) return;
    setError(null);
    const { data, error: err } = await create({
      input: {
        name: name.trim(),
        icon: icon.trim() || null,
        color,
        status,
        leadId: leadId === NONE ? null : leadId,
        targetDate: targetDate || null,
        teamIds,
        descriptionMd: description,
      },
    });
    if (err || !data) {
      setError(describeError(err).message);
      return;
    }
    showFlag({ title: m.project.created(data.createProject.name), severity: 'success' });
    onClose();
    navigate(`/project/${data.createProject.id}`);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={m.project.newTitle}
      size="md"
      isDirty={dirty}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()} data-testid="create-project-submit">
            {m.project.createAction}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <p role="alert" className="text-sm text-danger-fg">{error}</p> : null}
        <div className="flex items-end gap-3">
          <div className="w-20 shrink-0">
            <TextField label={m.common.icon} value={icon} maxLength={4} onChange={(e) => setIcon(e.target.value)} placeholder={m.project.iconPlaceholder} data-testid="project-icon" />
          </div>
          <div className="min-w-0 flex-1">
            <TextField
              label={m.project.name}
              value={name}
              required
              data-autofocus
              error={nameError}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              data-testid="project-name"
            />
          </div>
        </div>
        <Field label={m.common.color}>
          <div role="radiogroup" aria-label={m.common.color} className="flex flex-wrap gap-2">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                title={c}
                onClick={() => setColor(c)}
                className={clsx(
                  'flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors duration-100',
                  color === c ? 'border-fg' : 'border-transparent hover:border-border-input',
                )}
              >
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: `var(--ds-status-${c})` }} />
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Select
            label={m.project.status}
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            options={PROJECT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
          />
          <TextField label={m.project.targetDate} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={m.project.lead}>
            <PopupSelect
              label={m.project.lead}
              options={leads}
              value={leadId}
              onChange={setLeadId}
              renderTrigger={(t) => (
                <PropertyButton
                  ref={t.ref as never}
                  onClick={t.onClick}
                  onKeyDown={t.onKeyDown}
                  aria-haspopup="listbox"
                  aria-expanded={t.open}
                  className="h-8 w-full border border-border-input"
                  muted={!lead}
                  icon={lead ? <Avatar name={lead.name} src={lead.avatarUrl} size={16} /> : <Icon name="user" />}
                >
                  {lead?.name ?? m.project.noLead}
                </PropertyButton>
              )}
            />
          </Field>
          <Field label={m.project.teams}>
            <PopupSelect
              label={m.project.teams}
              multiple
              options={teams}
              value={teamIds}
              onChange={setTeamIds}
              renderTrigger={(t) => (
                <PropertyButton
                  ref={t.ref as never}
                  onClick={t.onClick}
                  onKeyDown={t.onKeyDown}
                  aria-haspopup="listbox"
                  aria-expanded={t.open}
                  className="h-8 w-full border border-border-input"
                  muted={teamIds.length === 0}
                  icon={teamIds.length === 1 && ws.teamsById.get(teamIds[0] ?? '') ? <TeamIcon team={ws.teamsById.get(teamIds[0] ?? '')!} /> : <Icon name="team" />}
                >
                  {teamIds.length === 0
                    ? m.project.noTeams
                    : teamIds.map((id) => ws.teamsById.get(id)?.key).filter(Boolean).join(', ')}
                </PropertyButton>
              )}
            />
          </Field>
        </div>
        <TextArea label={m.common.description} value={description} rows={4} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </Modal>
  );
}
