import { useMemo } from 'react';
import clsx from 'clsx';
import { Button, Checkbox, Lozenge, PopupSelect, Select, TextField } from '@velocity/ui';
import type { PopupOption } from '@velocity/ui';
import type { ImportRunFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { m } from '@/i18n';
import { SectionBody, SettingsSection } from '../common';
import { STATUS_CATEGORIES, parseMapping, parseSummary, retargetTeam, splitStatusKey, unmappedUsers } from './importModel';
import type { ImportMappingModel, StatusCategory, StatusTarget, TeamTarget } from './importModel';

const CREATE = '__create__';
const NONE = '__none__';

function Row({ warn, children, testId }: { warn?: boolean; children: React.ReactNode; testId?: string }) {
  return (
    <li className={clsx('flex min-h-10 items-center gap-4 px-4 py-1', warn && 'bg-warning-subtle')} data-testid={testId} data-unmapped={warn ? 'true' : undefined}>
      {children}
    </li>
  );
}

function ColumnHeads({ source, target, extra }: { source: string; target: string; extra?: string }) {
  return (
    <div className="flex h-8 items-center gap-4 border-b border-border px-4 text-xs font-semibold text-fg-subtle" aria-hidden="true">
      <span className="min-w-0 flex-1">{source}</span>
      <span className="flex w-90 shrink-0 gap-2">
        <span className="min-w-0 flex-1">{target}</span>
        {extra ? <span className="w-32 shrink-0">{extra}</span> : null}
      </span>
    </div>
  );
}

export interface ImportMappingStepProps {
  run: ImportRunFieldsFragment;
  onChange: (mapping: ImportMappingModel) => void;
  onDryRun: () => void;
  saving: boolean;
  dryRunning: boolean;
}

export function ImportMappingStep({ run, onChange, onDryRun, saving, dryRunning }: ImportMappingStepProps) {
  const t = m.settingsIntegrations.import.mapping;
  const { teams, activeUsers, teamsById } = useWorkspace();
  const mapping = useMemo(() => parseMapping(run.mapping ?? run.suggestedMapping), [run.mapping, run.suggestedMapping]);
  const summary = useMemo(() => parseSummary(run.summary), [run.summary]);

  const sourceTeamName = useMemo(() => new Map(summary.teams.map((x) => [x.externalId, x.name])), [summary.teams]);
  const sourceUser = useMemo(() => new Map(summary.users.map((x) => [x.externalId, x])), [summary.users]);
  const sourceCategories = useMemo(() => new Map(summary.statuses.map((s) => [`${s.teamExternalId}::${s.name}`, s.category])), [summary.statuses]);

  if (!mapping) return <p className="text-sm text-fg-subtle">{t.unavailable}</p>;

  const teamOptions: PopupOption[] = [
    ...teams.map((tm) => ({ value: tm.id, label: tm.name, description: tm.key, keywords: [tm.key] })),
    { value: CREATE, label: t.createTeam, group: t.createGroup },
  ];

  const setTeam = (ext: string, target: TeamTarget) => {
    const targetTeam = target.mode === 'existing' ? teamsById.get(target.teamId) ?? null : null;
    onChange(retargetTeam(mapping, ext, target, targetTeam ? { id: targetTeam.id, statuses: targetTeam.statuses } : null, sourceCategories));
  };

  const pickTeam = (ext: string, value: string) => {
    if (value === CREATE) {
      const key = ext.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10) || 'IMP';
      setTeam(ext, { mode: 'create', key: /^[A-Z]/.test(key) ? key : `X${key}`.slice(0, 10), name: sourceTeamName.get(ext) ?? ext });
    } else setTeam(ext, { mode: 'existing', teamId: value });
  };

  const setStatus = (key: string, target: StatusTarget) => onChange({ ...mapping, statuses: { ...mapping.statuses, [key]: target } });

  const unmapped = unmappedUsers(mapping);
  const teamEntries = Object.entries(mapping.teams);
  const statusEntries = Object.entries(mapping.statuses).sort(([a], [b]) => a.localeCompare(b));
  const userEntries = Object.entries(mapping.users).sort(([a], [b]) => a.localeCompare(b));
  const includeLabels = t.includeLabels;

  return (
    <div className="flex flex-col gap-8" data-testid="import-mapping">
      {summary.counts.issues > 0 ? (
        <p className="text-sm text-fg-subtle" data-testid="import-summary">
          {t.summary(summary.counts.issues, summary.counts.projects, summary.counts.cycles, summary.counts.labels)}
        </p>
      ) : null}

      <SettingsSection title={t.teams} description={t.teamsHelp}>
        <ColumnHeads source={t.sourceTeam} target={t.target} />
        <ul className="divide-y divide-border" data-testid="mapping-teams">
          {teamEntries.map(([ext, target]) => (
            <Row key={ext} testId={`map-team-${ext}`}>
              <div className="min-w-0 flex-1">
                <span className="font-mono text-sm text-fg">{ext}</span>
                {sourceTeamName.get(ext) && sourceTeamName.get(ext) !== ext ? <span className="ml-2 text-sm text-fg-subtle">{sourceTeamName.get(ext)}</span> : null}
              </div>
              <div className="flex w-90 shrink-0 flex-col gap-1 py-1">
                <PopupSelect
                  label={t.targetFor(ext)}
                  className="w-full justify-between"
                  triggerSize="sm"
                  options={teamOptions}
                  value={target.mode === 'existing' ? target.teamId : CREATE}
                  onChange={(v) => pickTeam(ext, v)}
                  searchPlaceholder={t.searchTeams}
                />
                {target.mode === 'create' ? (
                  <div className="flex items-center gap-1">
                    <TextField
                      aria-label={t.newTeamKey(ext)}
                      size="sm"
                      className="w-20 font-mono"
                      defaultValue={target.key}
                      key={`${ext}-key-${target.key}`}
                      maxLength={10}
                      onBlur={(e) => {
                        const key = e.target.value.trim().toUpperCase();
                        if (key && key !== target.key) setTeam(ext, { ...target, key });
                      }}
                    />
                    <TextField
                      aria-label={t.newTeamName(ext)}
                      size="sm"
                      defaultValue={target.name}
                      key={`${ext}-name-${target.name}`}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name && name !== target.name) setTeam(ext, { ...target, name });
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </Row>
          ))}
        </ul>
      </SettingsSection>

      {statusEntries.length > 0 ? (
        <SettingsSection title={t.statuses} description={t.statusesHelp}>
          <ColumnHeads source={t.sourceStatus} target={t.target} extra={t.category} />
          <ul className="divide-y divide-border" data-testid="mapping-statuses">
            {statusEntries.map(([key, target]) => {
              const { teamExternalId, name } = splitStatusKey(key);
              const teamTarget = mapping.teams[teamExternalId];
              const targetTeam = teamTarget?.mode === 'existing' ? teamsById.get(teamTarget.teamId) : undefined;
              const options: PopupOption[] = [
                ...(targetTeam ? targetTeam.statuses.map((s) => ({ value: s.id, label: s.name, description: m.settingsIntegrations.import.categories[s.category as StatusCategory] ?? s.category })) : []),
                { value: CREATE, label: t.createStatus(name), group: t.createGroup },
              ];
              return (
                <Row key={key} testId={`map-status-${key}`}>
                  <div className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-xs text-fg-subtle">{teamExternalId}</span>
                    <span className="mx-1 text-fg-subtlest">/</span>
                    <span className="text-sm text-fg">{name}</span>
                  </div>
                  <div className="flex w-90 shrink-0 items-center gap-2">
                    {targetTeam ? (
                      <PopupSelect
                        label={t.targetFor(name)}
                        className="min-w-0 flex-1 justify-between"
                        triggerSize="sm"
                        options={options}
                        value={target.mode === 'existing' ? target.statusId : CREATE}
                        onChange={(v) => {
                          if (v === CREATE) setStatus(key, { mode: 'create', name, category: 'todo' });
                          else setStatus(key, { mode: 'existing', statusId: v });
                        }}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm text-fg-subtle">{t.newStatusInNewTeam}</span>
                    )}
                    <span className="w-32 shrink-0">
                      {target.mode === 'create' ? (
                        <Select
                          size="sm"
                          aria-label={t.categoryFor(name)}
                          value={target.category}
                          options={STATUS_CATEGORIES.map((c) => ({ value: c, label: m.settingsIntegrations.import.categories[c] }))}
                          onChange={(e) => setStatus(key, { ...target, category: e.target.value as StatusCategory })}
                        />
                      ) : null}
                    </span>
                  </div>
                </Row>
              );
            })}
          </ul>
        </SettingsSection>
      ) : null}

      {userEntries.length > 0 ? (
        <SettingsSection title={t.members} description={t.membersHelp}>
          <ColumnHeads source={t.sourceMember} target={t.target} />
          <ul className="divide-y divide-border" data-testid="mapping-users">
            {userEntries.map(([ext, target]) => {
              const options: PopupOption[] = [
                { value: NONE, label: t.unassigned, description: t.unassignedHelp },
                ...activeUsers.map((u) => ({ value: u.id, label: u.name, description: `@${u.username}`, keywords: [u.username] })),
              ];
              const info = sourceUser.get(ext);
              return (
                <Row key={ext} warn={target === null} testId={`map-user-${ext}`}>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-sm text-fg">{info?.name ?? ext}</span>
                    {info?.email ? <span className="truncate font-mono text-xs text-fg-subtle">{info.email}</span> : null}
                    {target === null ? <Lozenge appearance="moved">{t.unmapped}</Lozenge> : null}
                  </div>
                  <div className="w-90 shrink-0">
                    <PopupSelect
                      label={t.targetFor(info?.name ?? ext)}
                      className="w-full justify-between"
                      triggerSize="sm"
                      options={options}
                      value={target ? target.userId : NONE}
                      onChange={(v) => onChange({ ...mapping, users: { ...mapping.users, [ext]: v === NONE ? null : { userId: v } } })}
                      searchPlaceholder={t.searchMembers}
                    />
                  </div>
                </Row>
              );
            })}
          </ul>
        </SettingsSection>
      ) : null}

      <SettingsSection title={t.include} description={t.includeHelp}>
        <SectionBody className="flex flex-wrap gap-x-6 gap-y-2">
          {(['projects', 'cycles', 'comments', 'relations', 'archived'] as const).map((k) => (
            <Checkbox
              key={k}
              label={includeLabels[k]}
              checked={mapping.include[k]}
              onChange={(e) => onChange({ ...mapping, include: { ...mapping.include, [k]: e.target.checked } })}
            />
          ))}
        </SectionBody>
      </SettingsSection>

      <div className="flex items-center justify-end gap-3">
        {unmapped.length > 0 ? <span className="text-sm text-warning-fg">{t.unmappedCount(unmapped.length)}</span> : null}
        <Button variant="primary" loading={dryRunning} disabled={saving} onClick={onDryRun} data-testid="import-dry-run">
          {t.runDryRun}
        </Button>
      </div>
    </div>
  );
}
