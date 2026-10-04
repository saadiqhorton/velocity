import { useMemo } from 'react';
import { Select, Switch } from '@velocity/ui';
import type { TeamFieldsFragment, UpdateTeamInput } from '@/gql/graphql';
import { SettingsRow, SettingsSection } from '../common';
import { SavedMark, timeZones, useSavedFlag } from './shared';
import { useUpdateTeam } from './teamMutations';
import { m } from '@/i18n';

/** Cycle settings apply as soon as a control changes (optimistic), with a "Saved" mark. */
export function TeamCyclesTab({ team }: { team: TeamFieldsFragment }) {
  const t = m.settingsWorkspace.cycles;
  const [saved, flash] = useSavedFlag();
  const [update] = useUpdateTeam(team, t.flag);
  const zones = useMemo(() => timeZones(team.cycleTimezone), [team.cycleTimezone]);
  const apply = async (input: UpdateTeamInput) => {
    const res = await update({ id: team.id, input });
    if (res.data) flash();
  };
  return (
    <SettingsSection
      title={t.section}
      description={t.description}
      actions={<SavedMark show={saved} />}
      testId="team-cycles-settings"
    >
      <SettingsRow label={t.enable} description={t.enableHelp}>
        <Switch checked={team.cycleEnabled} onChange={(v) => void apply({ cycleEnabled: v })} aria-label={t.enable} />
      </SettingsRow>
      {team.cycleEnabled ? (
        <>
          <SettingsRow label={t.length} description={t.lengthHelp} htmlFor="cycle-length">
            <Select
              id="cycle-length"
              className="w-40"
              value={String(team.cycleLengthWeeks)}
              onChange={(e) => void apply({ cycleLengthWeeks: Number(e.target.value) })}
              options={Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: t.weeks(i + 1) }))}
            />
          </SettingsRow>
          <SettingsRow label={t.startDay} description={t.startDayHelp} htmlFor="cycle-start">
            <Select
              id="cycle-start"
              className="w-40"
              value={String(team.cycleStartDay)}
              onChange={(e) => void apply({ cycleStartDay: Number(e.target.value) })}
              options={t.days.map((d, i) => ({ value: String(i), label: d }))}
            />
          </SettingsRow>
          <SettingsRow label={t.timezone} description={t.timezoneHelp} htmlFor="cycle-tz">
            <Select
              id="cycle-tz"
              className="w-64"
              value={team.cycleTimezone}
              onChange={(e) => void apply({ cycleTimezone: e.target.value })}
              options={zones.map((z) => ({ value: z, label: z }))}
            />
          </SettingsRow>
          <SettingsRow label={t.carryOver} description={t.carryOverHelp} htmlFor="cycle-carry">
            <Select
              id="cycle-carry"
              className="w-64"
              value={team.carryOver}
              onChange={(e) => void apply({ carryOver: e.target.value === 'backlog' ? 'backlog' : 'next_cycle' })}
              options={[
                { value: 'next_cycle', label: t.carryNext },
                { value: 'backlog', label: t.carryBacklog },
              ]}
            />
          </SettingsRow>
        </>
      ) : null}
    </SettingsSection>
  );
}
