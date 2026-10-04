import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Switch } from '@velocity/ui';
import { CreateTeamDocument } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { SettingsPage, SettingsRow, SettingsSection } from '../common';
import { TeamFormFields } from './TeamForm';
import type { TeamFormValues } from './TeamForm';
import { KEY_PATTERN, suggestKey } from './shared';
import { m } from '@/i18n';

export function NewTeamSettings() {
  const t = m.settingsWorkspace.newTeam;
  const navigate = useNavigate();
  const [values, setValues] = useState<TeamFormValues>({ name: '', key: '', color: 'blue', icon: '', description: '' });
  const [keyTouched, setKeyTouched] = useState(false);
  const [cycles, setCycles] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const [create, { loading }] = useOptimisticMutation(CreateTeamDocument, {
    optimistic: { serverConfirmed: 'The server mints the team id, default workflow and sort order.' },
    rollback: () => t.flag,
    silent: (code) => code === 'CONFLICT' || code === 'VALIDATION',
    refetchQueries: ['Bootstrap'],
  });

  const change = (patch: Partial<TeamFormValues>) => {
    const next = { ...values, ...patch };
    if (patch.key !== undefined) {
      setKeyTouched(true);
      setKeyError(null);
    } else if (patch.name !== undefined && !keyTouched) {
      next.key = suggestKey(patch.name);
    }
    setValues(next);
  };

  const valid = values.name.trim().length > 0 && KEY_PATTERN.test(values.key);
  const submit = async () => {
    if (!valid) return;
    const res = await create({
      input: {
        name: values.name.trim(),
        key: values.key,
        color: values.color,
        icon: values.icon.trim() || null,
        description: values.description.trim() || null,
        cycleEnabled: cycles,
      },
    });
    if (res.data) navigate(`/team/${res.data.createTeam.key}/active`);
    else if (res.error) setKeyError(res.error.code === 'CONFLICT' ? t.keyTaken : res.error.message);
  };

  return (
    <SettingsPage
      title={t.title}
      parents={[{ label: m.settings.sections.teams, to: '/settings/teams' }]}
      testId="settings-team-new"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
      >
        <SettingsSection title={t.title}>
          <TeamFormFields values={values} onChange={change} keyError={keyError} nameAutoFocus />
          <SettingsRow label={t.cycles} description={t.cyclesHelp}>
            <Switch checked={cycles} onChange={setCycles} aria-label={t.cycles} />
          </SettingsRow>
        </SettingsSection>
        <div className="flex items-center justify-end gap-2">
          <Button onClick={() => navigate('/settings/teams')}>{m.common.cancel}</Button>
          <Button type="submit" variant="primary" loading={loading} disabled={!valid}>
            {t.submit}
          </Button>
        </div>
      </form>
    </SettingsPage>
  );
}
