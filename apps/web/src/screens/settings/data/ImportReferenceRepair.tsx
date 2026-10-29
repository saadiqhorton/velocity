import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Button, ConfirmDialog, InlineMessage, Pagination, Skeleton } from '@velocity/ui';
import {
  ApplyImportReferenceRepairDocument,
  ImportReferenceRepairDocument,
  StartImportReferenceRepairDocument,
} from '@/gql/graphql';
import { describeError } from '@/lib/errors';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';
import { OwnerOnlyNotice, SettingsPage, SettingsSection, useIsOwner } from '../common';

interface RepairTarget {
  id: string;
  targetKind: string;
  sourceExternalId: string;
  status: string;
  skipReason: string | null;
  referenceCount: number;
  beforeMd: string;
  afterMd: string;
  context: { before: string; after: string };
}
interface RepairPreview {
  id: string;
  status: string;
  previewHash: string;
  error: string | null;
  summary: Record<string, number>;
  targets: RepairTarget[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function parseRepair(value: unknown): RepairPreview | null {
  const obj = record(value);
  if (!obj || typeof obj.id !== 'string' || typeof obj.status !== 'string' || typeof obj.previewHash !== 'string') return null;
  const rawSummary = record(obj.summary) ?? {};
  const summary = Object.fromEntries(Object.entries(rawSummary).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
  const targets = Array.isArray(obj.targets) ? obj.targets.flatMap((item): RepairTarget[] => {
    const t = record(item);
    const context = record(t?.context);
    return t && context && typeof t.id === 'string' && typeof t.targetKind === 'string' && typeof t.sourceExternalId === 'string'
      && typeof t.status === 'string' && (t.skipReason === null || typeof t.skipReason === 'string')
      && typeof t.referenceCount === 'number' && typeof t.beforeMd === 'string' && typeof t.afterMd === 'string'
      && typeof context.before === 'string' && typeof context.after === 'string'
      ? [{ id: t.id, targetKind: t.targetKind, sourceExternalId: t.sourceExternalId, status: t.status, skipReason: typeof t.skipReason === 'string' ? t.skipReason : null, referenceCount: t.referenceCount, beforeMd: t.beforeMd, afterMd: t.afterMd, context: { before: context.before, after: context.after } }]
      : [];
  }) : [];
  return { id: obj.id, status: obj.status, previewHash: obj.previewHash, error: typeof obj.error === 'string' ? obj.error : null, summary, targets };
}

export function ImportReferenceRepairPage() {
  const { runId = '', repairId } = useParams();
  return <ImportReferenceRepairContent key={`${runId}:${repairId ?? ''}`} runId={runId} repairId={repairId} />;
}

function ImportReferenceRepairContent({ runId, repairId }: { runId: string; repairId: string | undefined }) {
  const t = m.settingsIntegrations.import.referenceRepair;
  const navigate = useNavigate();
  const isOwner = useIsOwner();
  const [confirm, setConfirm] = useState(false);
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, loading, error, refetch } = useQuery(ImportReferenceRepairDocument, {
    variables: { id: repairId ?? '', first: 50, offset: (page - 1) * 50 }, skip: !repairId, fetchPolicy: 'cache-and-network',
  });
  const repair = useMemo(() => parseRepair(data?.importReferenceRepair), [data?.importReferenceRepair]);
  const [startScan, scanState] = useOptimisticMutation(StartImportReferenceRepairDocument, {
    optimistic: { serverConfirmed: 'The server scans text from this completed import.' }, rollback: () => t.flags.scanFailed, silent: true,
  });
  const [applyRepair, applyState] = useOptimisticMutation(ApplyImportReferenceRepairDocument, {
    optimistic: { serverConfirmed: 'The server verifies each previewed target before applying it.' }, rollback: () => t.flags.applyFailed, silent: true,
  });

  useEffect(() => {
    if (!repair || !['scanning', 'applying'].includes(repair.status)) return undefined;
    const timer = window.setInterval(() => void refetch(), 1500);
    return () => window.clearInterval(timer);
  }, [repair, refetch]);

  const beginScan = async () => {
    setActionError(null);
    const result = await startScan({ runId });
    const start = record(result.data?.startImportReferenceRepair);
    if (result.error) setActionError(describeError(result.error).message);
    else if (typeof start?.id === 'string') navigate(`/settings/import/${runId}/repair/${start.id}`);
  };
  const confirmApply = async () => {
    if (!repair) return;
    setActionError(null);
    const result = await applyRepair({ id: repair.id, previewHash: repair.previewHash, confirmed: true });
    setConfirm(false);
    if (result.error) setActionError(describeError(result.error).message);
    else void refetch();
  };
  const parents = [
    { label: m.settings.sections.import, to: '/settings/import' },
    { label: t.title, to: `/settings/import/${runId}` },
  ];
  const summary = repair?.summary ?? {};
  const summaryRows = [
    ['targets', t.summary.targets], ['references', t.summary.references], ['alreadyCorrect', t.summary.alreadyCorrect],
    ['unmapped', t.summary.unmapped], ['ambiguous', t.summary.ambiguous], ['stale', t.summary.stale],
    ['missing', t.summary.missing], ['codeSkipped', t.summary.codeSkipped],
  ] as const;

  return (
    <SettingsPage title={t.title} description={t.description} parents={parents} wide testId="import-reference-repair">
      <OwnerOnlyNotice />
      {error ? <InlineMessage appearance="error" action={<Button size="sm" onClick={() => void refetch()}>{m.common.retry}</Button>}>{describeError(error).message}</InlineMessage> : null}
      {actionError ? <InlineMessage appearance="error">{actionError}</InlineMessage> : null}
      {!repairId ? (
        <SettingsSection title={t.title} description={t.description}>
          {isOwner ? <div className="flex justify-end"><Button variant="primary" loading={scanState.loading} onClick={() => void beginScan()}>{t.scan}</Button></div> : null}
        </SettingsSection>
      ) : loading && !repair ? (
        <div className="flex flex-col gap-3" aria-busy="true"><Skeleton className="h-10 w-full" /><Skeleton className="h-48 w-full" /></div>
      ) : !repair ? (
        <InlineMessage appearance="warning">{m.errors.NOT_FOUND}</InlineMessage>
      ) : (
        <>
          {repair.status === 'scanning' ? <InlineMessage appearance="info">{t.scanning}</InlineMessage> : null}
          {repair.status === 'applying' ? <InlineMessage appearance="info">{t.applying}</InlineMessage> : null}
          {repair.status === 'failed' ? <InlineMessage appearance="error">{repair.error ?? actionError ?? t.stale}</InlineMessage> : null}
          {repair.status === 'completed' ? <InlineMessage appearance="success">{t.completed(summary.applied ?? 0, summary.skipped ?? 0)}</InlineMessage> : null}
          <SettingsSection title={t.title}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
              {summaryRows.map(([key, label]) => <div key={key}><dt className="text-xs text-fg-subtle">{label}</dt><dd className="font-mono text-sm text-fg">{summary[key] ?? 0}</dd></div>)}
            </dl>
          </SettingsSection>
          {repair.targets.length ? (
            <SettingsSection title={`${t.previewTitle} (${summary.targets ?? repair.targets.length})`}>
              <div className="flex flex-col gap-4">
                {repair.targets.map((target) => (
                  <article key={target.id} className="rounded-md border border-border p-4">
                    <div className="mb-3 flex items-center justify-between gap-4 text-sm">
                      <span className="font-mono text-fg">{target.sourceExternalId}</span>
                      <span className="text-fg-subtle">{target.targetKind} · {target.referenceCount} {t.refs} · {t.targetStatus(target.status, target.skipReason)}</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div><h3 className="mb-1 text-xs text-fg-subtle">{t.before}</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-surface-sunken p-3 text-xs text-fg">{target.beforeMd}</pre></div>
                      <div><h3 className="mb-1 text-xs text-fg-subtle">{t.after}</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-surface-sunken p-3 text-xs text-fg">{target.afterMd}</pre></div>
                    </div>
                    <p className="mt-2 text-xs text-fg-subtle">{target.context.before} → {target.context.after}</p>
                  </article>
                ))}
              </div>
              {(summary.targets ?? 0) > 50 ? (
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-sm text-fg-subtle">{t.showing((page - 1) * 50 + 1, Math.min(page * 50, summary.targets ?? 0), summary.targets ?? 0)}</span>
                  <Pagination page={page} pageCount={Math.ceil((summary.targets ?? 0) / 50)} onPageChange={setPage} />
                </div>
              ) : null}
            </SettingsSection>
          ) : repair.status === 'preview' ? <InlineMessage appearance="success">{t.noChanges}</InlineMessage> : null}
          {isOwner ? <div className="flex justify-end gap-2">
            {repair.status === 'completed' || repair.status === 'superseded' || repair.status === 'failed' ? <Button loading={scanState.loading} onClick={() => navigate(`/settings/import/${runId}/repair`)}>{t.rescan}</Button> : null}
            {repair.status === 'preview' && (summary.references ?? 0) > 0 ? <Button variant="primary" loading={applyState.loading} onClick={() => setConfirm(true)}>{t.apply}</Button> : null}
          </div> : null}
          <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title={t.confirmTitle} description={t.confirmBody} confirmLabel={t.confirmLabel} destructive={false} loading={applyState.loading} onConfirm={() => void confirmApply()} />
        </>
      )}
    </SettingsPage>
  );
}
