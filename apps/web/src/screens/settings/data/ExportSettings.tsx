import { useEffect } from 'react';
import { useQuery } from '@apollo/client';
import { Button, EmptyState, InlineMessage, Lozenge, Skeleton, Table, Tooltip } from '@velocity/ui';
import type { LozengeProps, TableColumn } from '@velocity/ui';
import { ExportsDocument, RequestExportDocument } from '@/gql/graphql';
import type { ExportsQuery } from '@/gql/graphql';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';
import { OwnerOnlyNotice, SettingsPage, SettingsSection, useIsOwner } from '../common';

type Row = ExportsQuery['exports'][number];

const APPEARANCE: Record<string, LozengeProps['appearance']> = {
  pending: 'default',
  running: 'inprogress',
  done: 'success',
  completed: 'success',
  failed: 'removed',
};

export function ExportSettings() {
  const t = m.settingsAccount.export;
  const isOwner = useIsOwner();
  const { data, loading, error, startPolling, stopPolling } = useQuery(ExportsDocument, { skip: !isOwner });
  const rows = data?.exports ?? [];
  const active = rows.some((r) => r.status === 'pending' || r.status === 'running');
  // Poll every 2s only while an export is in flight.
  useEffect(() => {
    if (!isOwner) return undefined;
    if (active) startPolling(2000);
    else stopPolling();
    return () => stopPolling();
  }, [active, isOwner, startPolling, stopPolling]);

  const [request, { loading: requesting }] = useOptimisticMutation(RequestExportDocument, {
    optimistic: { serverConfirmed: 'The export id and processing state are created by the server.' },
    refetchQueries: [ExportsDocument],
    rollback: () => t.requestFailed,
  });

  const label = (s: string) => (s === 'pending' ? t.pending : s === 'running' ? t.running : s === 'done' || s === 'completed' ? t.done : s === 'failed' ? t.failed : s);

  const columns: TableColumn<Row>[] = [
    {
      key: 'created',
      header: t.created,
      render: (r) => (
        <Tooltip content={formatDateTime(r.createdAt)}>
          <span className="text-fg">{formatRelative(r.createdAt)}</span>
        </Tooltip>
      ),
    },
    {
      key: 'status',
      header: t.status,
      render: (r) => (
        <span className="flex items-center gap-2">
          <Lozenge appearance={APPEARANCE[r.status] ?? 'default'}>{label(r.status)}</Lozenge>
          {r.status === 'failed' ? <span className="max-w-64 truncate text-sm text-fg-subtle" title={r.error ?? t.failedDefault}>{r.error ?? t.failedDefault}</span> : null}
        </span>
      ),
    },
    { key: 'size', header: t.size, render: (r) => <span className="identifier">{r.size != null ? formatBytes(r.size) : '–'}</span> },
    {
      key: 'download',
      header: <span className="sr-only">{t.download}</span>,
      align: 'right',
      render: (r) =>
        r.status === 'done' || r.status === 'completed' ? (
          <a
            href={`/api/exports/${r.id}/download`}
            aria-label={t.downloadLabel(formatDateTime(r.createdAt))}
            className="inline-flex h-7 items-center rounded-sm px-2 text-sm text-link hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {t.download}
          </a>
        ) : null,
    },
  ];

  return (
    <SettingsPage
      title={m.settings.sections.export}
      description={t.description}
      wide
      testId="settings-export"
      actions={
        <Button variant="primary" loading={requesting} disabled={!isOwner || active} onClick={() => void request({})}>
          {t.request}
        </Button>
      }
    >
      <OwnerOnlyNotice />
      {isOwner ? (
        <SettingsSection title={t.listTitle}>
          {loading && !data ? (
            <div className="p-4"><Skeleton height={32} rows={3} /></div>
          ) : error ? (
            <div className="p-4">
              <InlineMessage appearance="error">{t.loadFailed}</InlineMessage>
            </div>
          ) : (
            <Table aria-label={t.table} columns={columns} rows={rows} rowKey={(r) => r.id} emptyState={<EmptyState icon="download" message={t.empty} />} />
          )}
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
}
