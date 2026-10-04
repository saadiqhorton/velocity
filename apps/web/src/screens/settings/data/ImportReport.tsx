import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSubscription } from '@apollo/client';
import { Button, ConfirmDialog, InlineMessage, Pagination, ProgressBar, Table } from '@velocity/ui';
import type { TableColumn } from '@velocity/ui';
import { CancelImportDocument, ImportProgressDocument } from '@/gql/graphql';
import type { ImportRunFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';
import { SectionBody, SettingsSection } from '../common';
import { parseMapping, parseReport } from './importModel';
import type { ReportWarning } from './importModel';

const WARNINGS_PAGE = 10;

/** Warnings can run to hundreds of rows: explicit pagination (SPEC §4.9.12). */
function WarningsTable({ warnings, title }: { warnings: ReportWarning[]; title: string }) {
  const t = m.settingsIntegrations.import.report;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(warnings.length / WARNINGS_PAGE));
  const current = Math.min(page, pageCount);
  const rows = warnings.slice((current - 1) * WARNINGS_PAGE, current * WARNINGS_PAGE);
  const columns: TableColumn<ReportWarning>[] = [
    { key: 'code', header: t.columns.code, width: 200, render: (w) => <code className="font-mono text-xs text-fg-subtle">{w.code}</code> },
    { key: 'message', header: t.columns.message, render: (w) => <span className="text-sm text-fg">{w.message}</span> },
    { key: 'record', header: t.columns.record, width: 120, render: (w) => (w.externalId ? <span className="identifier">{w.externalId}</span> : null) },
  ];
  return (
    <SettingsSection title={`${title} (${warnings.length})`} testId="import-warnings">
      <Table aria-label={title} columns={columns} rows={rows} rowKey={(w) => `${w.code}:${w.externalId ?? ''}:${w.message}`} stickyHeader={false} />
      {pageCount > 1 ? (
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <span className="text-sm text-fg-subtle">{t.range((current - 1) * WARNINGS_PAGE + 1, Math.min(current * WARNINGS_PAGE, warnings.length), warnings.length)}</span>
          <Pagination page={current} pageCount={pageCount} onPageChange={setPage} />
        </div>
      ) : null}
    </SettingsSection>
  );
}

interface CountRow {
  key: string;
  label: string;
  create: number;
  skip: number | null;
}

export interface DryRunStepProps {
  run: ImportRunFieldsFragment;
  onBack: () => void;
  onCommit: () => void;
  committing: boolean;
  backing: boolean;
}

export function DryRunStep({ run, onBack, onCommit, committing, backing }: DryRunStepProps) {
  const t = m.settingsIntegrations.import.report;
  const [confirm, setConfirm] = useState(false);
  const report = useMemo(() => parseReport(run.report), [run.report]);
  if (!report) return <InlineMessage appearance="warning">{t.missing}</InlineMessage>;
  const c = report.counts;
  const rows: CountRow[] = [
    { key: 'teams', label: t.entities.teams, create: c.teamsToCreate, skip: null },
    { key: 'statuses', label: t.entities.statuses, create: c.statusesToCreate, skip: null },
    { key: 'labels', label: t.entities.labels, create: c.labelsToCreate, skip: null },
    { key: 'projects', label: t.entities.projects, create: c.projectsToCreate, skip: null },
    { key: 'cycles', label: t.entities.cycles, create: c.cyclesToCreate, skip: null },
    { key: 'issues', label: t.entities.issues, create: c.issues, skip: c.skippedIssues },
    { key: 'comments', label: t.entities.comments, create: c.comments, skip: null },
    { key: 'relations', label: t.entities.relations, create: c.relations, skip: null },
  ];
  const columns: TableColumn<CountRow>[] = [
    { key: 'entity', header: t.columns.entity, render: (r) => <span className="text-sm text-fg">{r.label}</span> },
    { key: 'create', header: t.columns.create, width: 120, align: 'right', render: (r) => <span className="font-mono text-sm text-fg">{r.create}</span> },
    { key: 'skip', header: t.columns.skip, width: 120, align: 'right', render: (r) => <span className="font-mono text-sm text-fg-subtle">{r.skip ?? t.none}</span> },
  ];
  const unmapped = report.unmapped;
  const hasUnmapped = unmapped.users.length + unmapped.statuses.length + unmapped.teams.length > 0;

  return (
    <div className="flex flex-col gap-8" data-testid="import-dryrun">
      <SettingsSection title={t.title} description={t.help}>
        <Table aria-label={t.title} columns={columns} rows={rows} rowKey={(r) => r.key} stickyHeader={false} />
      </SettingsSection>

      {hasUnmapped ? (
        <InlineMessage appearance="warning" title={t.unmappedTitle}>
          <ul className="mt-1 flex flex-col gap-0.5">
            {unmapped.teams.length ? <li>{t.unmappedTeams}: <span className="font-mono">{unmapped.teams.join(', ')}</span></li> : null}
            {unmapped.statuses.length ? <li>{t.unmappedStatuses}: <span className="font-mono">{unmapped.statuses.join(', ')}</span></li> : null}
            {unmapped.users.length ? <li>{t.unmappedUsers}: <span className="font-mono">{unmapped.users.join(', ')}</span></li> : null}
          </ul>
        </InlineMessage>
      ) : null}

      {report.warnings.length > 0 ? <WarningsTable warnings={report.warnings} title={t.warnings} /> : <InlineMessage appearance="success">{t.noWarnings}</InlineMessage>}

      <div className="flex items-center justify-end gap-2">
        <Button loading={backing} onClick={onBack}>
          {t.editMapping}
        </Button>
        <Button variant="primary" loading={committing} onClick={() => setConfirm(true)} data-testid="import-commit">
          {t.commit(c.issues)}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t.confirmTitle(c.issues)}
        description={t.confirmBody}
        confirmLabel={t.commit(c.issues)}
        destructive={false}
        loading={committing}
        onConfirm={() => {
          setConfirm(false);
          onCommit();
        }}
      />
    </div>
  );
}

export interface CommitStepProps {
  run: ImportRunFieldsFragment;
  onResume: () => void;
  resuming: boolean;
  onNew: () => void;
  refetch: () => void;
}

export function CommitStep({ run, onResume, resuming, onNew, refetch }: CommitStepProps) {
  const t = m.settingsIntegrations.import.commit;
  const { teamsById } = useWorkspace();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const committing = run.status === 'committing';
  const report = useMemo(() => parseReport(run.report), [run.report]);
  const mapping = useMemo(() => parseMapping(run.mapping), [run.mapping]);

  // Live progress: the subscription writes the run into the cache; when it ends, refetch the run.
  const { data: live } = useSubscription(ImportProgressDocument, { variables: { runId: run.id }, skip: !committing });
  const liveStatus = live?.importProgress?.status;
  useEffect(() => {
    if (liveStatus && liveStatus !== 'committing') refetch();
  }, [liveStatus, refetch]);
  // Safety net when the socket drops mid-commit: the run state is server-owned, so a slow poll is enough.
  useEffect(() => {
    if (!committing) return undefined;
    const id = window.setInterval(refetch, 5000);
    return () => window.clearInterval(id);
  }, [committing, refetch]);

  const [cancel, cancelState] = useOptimisticMutation(CancelImportDocument, {
    optimistic: () => ({ __typename: 'Mutation', cancelImport: { ...run, status: 'canceled' as ImportRunFieldsFragment['status'] } }),
    rollback: () => m.settingsIntegrations.import.flags.cancelFailed,
  });

  const total = report?.result ? report.result.counts.issues ?? 0 : report?.counts.issues ?? 0;
  const percent = run.status === 'completed' ? 100 : run.progress * 100;
  const result = report?.result ?? null;

  const teamLinks = useMemo(() => {
    if (!mapping) return [] as { key: string; id: string }[];
    const seen = new Set<string>();
    return Object.values(mapping.teams).flatMap((x) => {
      if (x.mode !== 'existing' || seen.has(x.teamId)) return [];
      seen.add(x.teamId);
      const team = teamsById.get(x.teamId);
      return team ? [{ key: team.key, id: team.id }] : [];
    });
  }, [mapping, teamsById]);

  const resultRows = result
    ? (Object.keys(t.resultLabels) as (keyof typeof t.resultLabels)[])
        .filter((k) => k in result.counts)
        .map((k) => ({ key: k, label: t.resultLabels[k], value: result.counts[k] ?? 0 }))
    : [];
  const resultColumns: TableColumn<{ key: string; label: string; value: number }>[] = [
    { key: 'entity', header: m.settingsIntegrations.import.report.columns.entity, render: (r) => <span className="text-sm text-fg">{r.label}</span> },
    { key: 'value', header: t.created, width: 120, align: 'right', render: (r) => <span className="font-mono text-sm text-fg">{r.value}</span> },
  ];

  return (
    <div className="flex flex-col gap-8" data-testid="import-commit-step">
      {run.status === 'failed' ? (
        <InlineMessage
          appearance="error"
          title={t.failedTitle}
          action={
            <Button size="sm" variant="default" loading={resuming} onClick={onResume} data-testid="import-resume">
              {t.resume}
            </Button>
          }
        >
          {run.error ?? t.failedBody}
          <span className="block">{t.resumeHelp}</span>
        </InlineMessage>
      ) : null}
      {run.status === 'canceled' ? (
        <InlineMessage appearance="info" title={t.canceledTitle} action={<Button size="sm" onClick={onNew}>{t.newImport}</Button>}>
          {t.canceledBody(run.committedCount)}
        </InlineMessage>
      ) : null}
      {run.status === 'completed' ? (
        <InlineMessage appearance="success" title={t.completedTitle} action={<Button size="sm" onClick={onNew}>{t.newImport}</Button>}>
          {t.completedBody(run.committedCount)}
        </InlineMessage>
      ) : null}

      {run.status !== 'canceled' ? (
        <SettingsSection title={t.progress}>
          <SectionBody className="flex flex-col gap-3" >
            <ProgressBar value={percent} label={t.progress} showPercent />
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-fg-subtle" data-testid="import-counts" aria-live="polite">
                {t.issuesOf(run.committedCount, total)}
              </span>
              {committing ? (
                <Button size="sm" loading={cancelState.loading} onClick={() => setConfirmCancel(true)}>
                  {t.cancel}
                </Button>
              ) : null}
            </div>
          </SectionBody>
        </SettingsSection>
      ) : null}

      {run.status === 'completed' && result ? (
        <SettingsSection title={t.resultTitle}>
          <Table aria-label={t.resultTitle} columns={resultColumns} rows={resultRows} rowKey={(r) => r.key} stickyHeader={false} />
        </SettingsSection>
      ) : null}
      {run.status === 'completed' && teamLinks.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-fg-subtle">{t.openTeams}</span>
          {teamLinks.map((x) => (
            <Link key={x.id} to={`/team/${x.key}/active`} className="font-mono text-link underline">
              {x.key}
            </Link>
          ))}
        </div>
      ) : null}
      {result && result.warnings.length > 0 ? <WarningsTable warnings={result.warnings} title={m.settingsIntegrations.import.report.warnings} /> : null}

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t.cancelTitle}
        description={t.cancelBody}
        confirmLabel={t.cancel}
        cancelLabel={t.keepRunning}
        loading={cancelState.loading}
        onConfirm={() => void cancel({ id: run.id }).then(() => setConfirmCancel(false))}
      />
    </div>
  );
}
