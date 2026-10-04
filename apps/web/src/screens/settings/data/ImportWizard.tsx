import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Button, Field, Icon, InlineMessage, Radio, RadioGroup, Skeleton, TextField } from '@velocity/ui';
import {
  CommitImportDocument,
  CreateImportRunFromApiDocument,
  CreateImportRunFromCsvDocument,
  DryRunImportDocument,
  ImportRunDocument,
  ImportRunsDocument,
  UpdateImportMappingDocument,
} from '@/gql/graphql';
import type { ImportRunFieldsFragment } from '@/gql/graphql';
import { describeError } from '@/lib/errors';
import { useOptimisticMutation } from '@/lib/mutation';
import { formatBytes } from '@/lib/format';
import { NotFound } from '@/screens/workspace/NotFound';
import { m } from '@/i18n';
import { OwnerOnlyNotice, SectionBody, SettingsPage, SettingsSection } from '../common';
import { ImportMappingStep } from './ImportMapping';
import { CommitStep, DryRunStep } from './ImportReport';
import { ImportStepper } from './ImportStepper';
import { RunStatus, sourceLabel } from './importParts';
import { stepOf } from './importModel';
import type { ImportMappingModel } from './importModel';

type SourceId = 'linear-csv' | 'jira-csv' | 'linear-api' | 'github';

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function NewImportPage() {
  const t = m.settingsIntegrations.import;
  const navigate = useNavigate();
  const [source, setSource] = useState<SourceId>('linear-csv');
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [teamKeys, setTeamKeys] = useState('');
  const [token, setToken] = useState('');
  const [repos, setRepos] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [createFromCsv, csvState] = useOptimisticMutation(CreateImportRunFromCsvDocument, {
    optimistic: { serverConfirmed: 'The server parses the file and mints the run id.' },
    rollback: () => t.flags.createFailed,
    silent: true,
    refetchQueries: [ImportRunsDocument],
  });
  const [createFromApi, apiState] = useOptimisticMutation(CreateImportRunFromApiDocument, {
    optimistic: { serverConfirmed: 'The server fetches the source data and mints the run id.' },
    rollback: () => t.flags.createFailed,
    silent: true,
    refetchQueries: [ImportRunsDocument],
  });

  const isCsv = source === 'linear-csv' || source === 'jira-csv';
  const canSubmit = isCsv ? file !== null : source === 'linear-api' ? apiKey.trim().length > 0 : token.trim().length > 0 && splitList(repos).length > 0;

  const submit = async () => {
    setError(null);
    if (isCsv && file) {
      setReading(true);
      let csv: string;
      try {
        csv = await file.text();
      } catch {
        setReading(false);
        setError(t.source.readFailed);
        return;
      }
      setReading(false);
      const { data, error: err } = await createFromCsv({ input: { source: source === 'jira-csv' ? 'jira' : 'linear', csv, fileName: file.name } });
      if (err) setError(err.message);
      else if (data) navigate(`/settings/import/${data.createImportRunFromCsv.id}`, { replace: true });
    } else if (source === 'linear-api') {
      const keys = splitList(teamKeys).map((k) => k.toUpperCase());
      const { data, error: err } = await createFromApi({ input: { source: 'linear', apiKey: apiKey.trim(), teamKeys: keys.length ? keys : null } });
      if (err) setError(err.message);
      else if (data) navigate(`/settings/import/${data.createImportRunFromApi.id}`, { replace: true });
    } else if (source === 'github') {
      const { data, error: err } = await createFromApi({ input: { source: 'github', token: token.trim(), repos: splitList(repos) } });
      if (err) setError(err.message);
      else if (data) navigate(`/settings/import/${data.createImportRunFromApi.id}`, { replace: true });
    }
  };

  return (
    <SettingsPage title={t.newImport} parents={[{ label: m.settings.sections.import, to: '/settings/import' }]} wide testId="import-source">
      <OwnerOnlyNotice />
      <ImportStepper current={1} />
      <SettingsSection title={t.source.title} description={t.source.help}>
        <SectionBody className="flex flex-col gap-4">
          <RadioGroup label={t.source.title} value={source} onChange={(v) => { setSource(v as SourceId); setError(null); }} className="gap-3">
            <Radio value="linear-csv" label={t.sources.linearCsv} />
            <Radio value="jira-csv" label={t.sources.jiraCsv} />
            <Radio value="linear-api" label={t.sources.linearApi} />
            <Radio value="github" label={t.sources.githubApi} />
          </RadioGroup>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            {isCsv ? (
              <Field label={t.source.file} helperText={source === 'linear-csv' ? t.source.linearCsvHelp : t.source.jiraCsvHelp}>
                <div className="flex items-center gap-3">
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    aria-label={t.source.file}
                    data-testid="import-file"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <Button iconBefore={<Icon name="upload" />} onClick={() => fileInput.current?.click()}>
                    {file ? t.source.chooseOther : t.source.choose}
                  </Button>
                  {file ? (
                    <span className="min-w-0 truncate font-mono text-sm text-fg">
                      {file.name} <span className="text-fg-subtle">({formatBytes(file.size)})</span>
                    </span>
                  ) : (
                    <span className="text-sm text-fg-subtle">{t.source.noFile}</span>
                  )}
                </div>
              </Field>
            ) : source === 'linear-api' ? (
              <>
                <Field label={t.source.linearKey} helperText={t.source.linearKeyHelp}>
                  <TextField type="password" autoComplete="off" className="font-mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                </Field>
                <Field label={t.source.teamKeys} helperText={t.source.teamKeysHelp}>
                  <TextField className="font-mono" value={teamKeys} placeholder="ENG, WEB" onChange={(e) => setTeamKeys(e.target.value)} />
                </Field>
              </>
            ) : (
              <>
                <Field label={t.source.githubToken} helperText={t.source.githubTokenHelp}>
                  <TextField type="password" autoComplete="off" className="font-mono" value={token} onChange={(e) => setToken(e.target.value)} />
                </Field>
                <Field label={t.source.repos} helperText={t.source.reposHelp}>
                  <TextField className="font-mono" value={repos} placeholder="acme/service, acme/web" onChange={(e) => setRepos(e.target.value)} />
                </Field>
              </>
            )}
            {error ? <InlineMessage appearance="error">{error}</InlineMessage> : null}
          </div>
        </SectionBody>
      </SettingsSection>
      <div className="flex justify-end gap-2">
        <Button onClick={() => navigate('/settings/import')}>{m.common.cancel}</Button>
        <Button variant="primary" disabled={!canSubmit} loading={reading || csvState.loading || apiState.loading} onClick={() => void submit()} data-testid="import-continue">
          {t.source.continue}
        </Button>
      </div>
    </SettingsPage>
  );
}

/** Run detail: the step shown is derived from the run's server status, so reload and resume land correctly. */
export function ImportRunPage() {
  const t = m.settingsIntegrations.import;
  const { runId = '' } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useQuery(ImportRunDocument, { variables: { id: runId }, fetchPolicy: 'cache-and-network' });
  const run = data?.importRun ?? null;

  const [updateMapping, mappingState] = useOptimisticMutation(UpdateImportMappingDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      updateImportMapping: { ...(run as NonNullable<typeof run>), mapping: vars.mapping, status: 'mapping' as ImportRunFieldsFragment['status'], report: null },
    }),
    rollback: () => t.flags.mappingFailed,
    silent: true,
  });
  const [dryRun, dryState] = useOptimisticMutation(DryRunImportDocument, {
    optimistic: { serverConfirmed: 'The server computes the report from the stored source data.' },
    rollback: () => t.flags.dryRunFailed,
    silent: true,
  });
  const [commit, commitState] = useOptimisticMutation(CommitImportDocument, {
    optimistic: { serverConfirmed: 'The server starts the commit job and reports progress.' },
    rollback: () => t.flags.commitFailed,
    silent: true,
  });
  const [actionError, setActionError] = useState<string | null>(null);

  const parents = [{ label: m.settings.sections.import, to: '/settings/import' }];
  if (loading && !run) {
    return (
      <SettingsPage title={t.runTitle} parents={parents} wide>
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-6 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      </SettingsPage>
    );
  }
  if (error && !run) {
    return (
      <SettingsPage title={t.runTitle} parents={parents} wide>
        <InlineMessage appearance="error" action={<Button size="sm" onClick={() => void refetch()}>{m.common.retry}</Button>}>
          {describeError(error).message}
        </InlineMessage>
      </SettingsPage>
    );
  }
  if (!run) return <NotFound />;

  const step = stepOf(run.status);
  const saveMapping = (mapping: ImportMappingModel) => updateMapping({ id: run.id, mapping });
  const runDry = async () => {
    setActionError(null);
    const { error: err } = await dryRun({ id: run.id });
    if (err) setActionError(err.message);
  };
  const startCommit = async () => {
    setActionError(null);
    const { error: err } = await commit({ id: run.id });
    if (err) setActionError(err.message);
  };
  const backToMapping = async () => {
    setActionError(null);
    const mapping = run.mapping ?? run.suggestedMapping;
    const { error: err } = await updateMapping({ id: run.id, mapping });
    if (err) setActionError(err.message);
  };

  return (
    <SettingsPage
      title={run.fileName ?? sourceLabel(run.source)}
      description={
        <span className="inline-flex items-center gap-2">
          {sourceLabel(run.source)}
          <RunStatus status={run.status} />
        </span>
      }
      parents={parents}
      wide
      testId="import-run"
    >
      <OwnerOnlyNotice />
      <ImportStepper current={step} />
      {actionError ? (
        <InlineMessage appearance="error" onDismiss={() => setActionError(null)}>
          {actionError}
        </InlineMessage>
      ) : null}
      {step === 2 ? (
        <ImportMappingStep run={run} onChange={(mapping) => void saveMapping(mapping)} saving={mappingState.loading} onDryRun={() => void runDry()} dryRunning={dryState.loading} />
      ) : step === 3 ? (
        <DryRunStep run={run} onBack={() => void backToMapping()} onCommit={() => void startCommit()} committing={commitState.loading} backing={mappingState.loading} />
      ) : (
        <CommitStep run={run} onResume={() => void startCommit()} resuming={commitState.loading} onNew={() => navigate('/settings/import/new')} refetch={() => void refetch()} />
      )}
    </SettingsPage>
  );
}
