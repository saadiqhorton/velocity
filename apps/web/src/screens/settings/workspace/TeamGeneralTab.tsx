import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal, Select, TextField, InlineMessage } from '@velocity/ui';
import { ArchiveTeamDocument, DeleteTeamDocument } from '@/gql/graphql';
import type { TeamFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useOptimisticMutation } from '@/lib/mutation';
import { SectionBody, SettingsRow, SettingsSection, useIsOwner } from '../common';
import { TeamFormFields } from './TeamForm';
import type { TeamFormValues } from './TeamForm';
import { KEY_PATTERN, SavedMark, useSavedFlag } from './shared';
import { useUpdateTeam } from './teamMutations';
import { m } from '@/i18n';

export function TeamGeneralTab({ team }: { team: TeamFieldsFragment }) {
  return (
    <>
      <DetailsForm key={team.id} team={team} />
      <ArchiveAndDelete team={team} />
    </>
  );
}

function DetailsForm({ team }: { team: TeamFieldsFragment }) {
  const t = m.settingsWorkspace.team;
  const navigate = useNavigate();
  const [values, setValues] = useState<TeamFormValues>({
    name: team.name,
    key: team.key,
    color: team.color,
    icon: team.icon ?? '',
    description: team.description ?? '',
  });
  const [keyError, setKeyError] = useState<string | null>(null);
  const [saved, flash] = useSavedFlag();
  const [update, { loading }] = useUpdateTeam(team, t.flag.save, { silent: (code) => code === 'CONFLICT', refetchQueries: ['Bootstrap'] });

  const dirty =
    values.name.trim() !== team.name ||
    values.key !== team.key ||
    values.color !== team.color ||
    values.icon.trim() !== (team.icon ?? '') ||
    values.description.trim() !== (team.description ?? '');
  const valid = values.name.trim().length > 0 && KEY_PATTERN.test(values.key);

  const save = async () => {
    if (!valid || !dirty) return;
    const res = await update({
      id: team.id,
      input: {
        name: values.name.trim(),
        key: values.key,
        color: values.color,
        icon: values.icon.trim() || null,
        description: values.description.trim() || null,
      },
    });
    if (res.data) {
      flash();
      if (values.key !== team.key) navigate(`/settings/teams/${values.key}`, { replace: true });
    } else if (res.error) {
      setKeyError(res.error.message);
    }
  };

  return (
    <SettingsSection title={t.generalSection}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TeamFormFields
          values={values}
          onChange={(patch) => {
            if (patch.key !== undefined) setKeyError(null);
            setValues((v) => ({ ...v, ...patch }));
          }}
          keyError={keyError}
          warnKeyChange={values.key !== team.key && KEY_PATTERN.test(values.key)}
        />
        <SectionBody className="flex items-center justify-end gap-3 border-t border-border">
          <SavedMark show={saved} />
          <Button type="submit" variant="primary" loading={loading} disabled={!dirty || !valid}>
            {t.save}
          </Button>
        </SectionBody>
      </form>
    </SettingsSection>
  );
}

function ArchiveAndDelete({ team }: { team: TeamFieldsFragment }) {
  const t = m.settingsWorkspace.team;
  const navigate = useNavigate();
  const isOwner = useIsOwner();
  const { teams } = useWorkspace();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const archived = team.archivedAt !== null;
  const [archive, { loading: archiving }] = useOptimisticMutation(ArchiveTeamDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      archiveTeam: { __typename: 'Team' as const, id: vars.id, archivedAt: vars.archived ? new Date().toISOString() : null },
    }),
    rollback: () => t.flag.archive,
    refetchQueries: ['Bootstrap', 'TeamsAdmin'],
  });
  return (
    <SettingsSection title={t.archiveSection} danger={isOwner}>
      <SettingsRow label={archived ? t.unarchiveRow : t.archiveRow} description={archived ? t.unarchiveRowHelp : t.archiveRowHelp}>
        <Button loading={archiving} onClick={() => void archive({ id: team.id, archived: !archived })}>
          {archived ? m.common.unarchive : m.common.archive}
        </Button>
      </SettingsRow>
      {isOwner ? (
        <SettingsRow label={t.deleteRow} description={t.deleteRowHelp}>
          <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={teams.filter((x) => x.id !== team.id).length === 0}>
            {m.common.delete}
          </Button>
        </SettingsRow>
      ) : null}
      {deleteOpen ? (
        <DeleteTeamModal
          team={team}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false);
            navigate('/settings/teams');
          }}
        />
      ) : null}
    </SettingsSection>
  );
}

function DeleteTeamModal({ team, onClose, onDeleted }: { team: TeamFieldsFragment; onClose: () => void; onDeleted: () => void }) {
  const t = m.settingsWorkspace.team;
  const { teams } = useWorkspace();
  const targets = teams.filter((x) => x.id !== team.id);
  const [target, setTarget] = useState(targets[0]?.id ?? '');
  const [confirm, setConfirm] = useState('');
  const [del, { loading }] = useOptimisticMutation(DeleteTeamDocument, {
    optimistic: { serverConfirmed: 'Deleting moves every issue to another team and mints new numbers on the server.' },
    rollback: () => t.flag.delete,
    refetchQueries: ['Bootstrap', 'TeamsAdmin'],
  });
  const ok = confirm.trim().toUpperCase() === team.key && (targets.length === 0 || target !== '');
  const submit = async () => {
    if (!ok) return;
    const res = await del({ id: team.id, confirmKey: team.key, moveIssuesToTeamId: target || null });
    if (res.data) onDeleted();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t.deleteTitle(team.name)}
      description={t.deleteBody(team.openIssueCount)}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{m.common.cancel}</Button>
          <Button variant="danger" loading={loading} disabled={!ok} onClick={() => void submit()}>
            {t.deleteConfirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {targets.length === 0 ? (
          <InlineMessage appearance="warning">{t.deleteNoTeams}</InlineMessage>
        ) : (
          <Select id="team-delete-move-to" label={t.deleteMoveTo} value={target} onChange={(e) => setTarget(e.target.value)} options={targets.map((x) => ({ value: x.id, label: `${x.name} (${x.key})` }))} />
        )}
        <TextField label={t.deleteConfirmLabel(team.key)} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" data-autofocus />
      </div>
    </Modal>
  );
}
