import { Route, Routes, useNavigate } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Button, EmptyState, Icon, InlineMessage, Skeleton, Table } from '@velocity/ui';
import type { TableColumn } from '@velocity/ui';
import { ImportRunsDocument } from '@/gql/graphql';
import type { ImportRunFieldsFragment } from '@/gql/graphql';
import { describeError } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import { NotFound } from '@/screens/workspace/NotFound';
import { m } from '@/i18n';
import { OwnerOnlyNotice, SettingsPage } from '../common';
import { ImportRunPage, NewImportPage } from './ImportWizard';
import { RunStatus, sourceLabel } from './importParts';
import { isUnfinished } from './importModel';

function ImportList() {
  const t = m.settingsIntegrations.import;
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useQuery(ImportRunsDocument, { fetchPolicy: 'cache-and-network' });
  const runs = data?.importRuns ?? [];

  const columns: TableColumn<ImportRunFieldsFragment>[] = [
    {
      key: 'source',
      header: t.columns.source,
      render: (r) => (
        <div className="min-w-0">
          <div className="text-sm text-fg">{sourceLabel(r.source)}</div>
          {r.fileName ? <div className="truncate font-mono text-xs text-fg-subtle">{r.fileName}</div> : null}
        </div>
      ),
    },
    { key: 'status', header: t.columns.status, width: 128, render: (r) => <RunStatus status={r.status} /> },
    { key: 'imported', header: t.columns.imported, width: 96, align: 'right', render: (r) => <span className="text-sm text-fg-subtle">{r.committedCount}</span> },
    { key: 'started', header: t.columns.started, width: 128, render: (r) => <span className="text-sm text-fg-subtle">{formatRelative(r.createdAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">{t.columns.actions}</span>,
      headerLabel: t.columns.actions,
      width: 96,
      align: 'right',
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Button size="sm" variant={isUnfinished(r.status) ? 'default' : 'subtle'} onClick={() => navigate(r.id)}>
            {isUnfinished(r.status) ? t.resume : t.view}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <SettingsPage
      title={m.settings.sections.import}
      description={t.description}
      wide
      testId="settings-import"
      actions={
        runs.length > 0 ? (
          <Button variant="primary" iconBefore={<Icon name="add" />} onClick={() => navigate('new')}>
            {t.newImport}
          </Button>
        ) : null
      }
    >
      <OwnerOnlyNotice />
      {loading && !data ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <InlineMessage appearance="error" action={<Button size="sm" onClick={() => void refetch()}>{m.common.retry}</Button>}>
          {describeError(error).message}
        </InlineMessage>
      ) : runs.length === 0 ? (
        <div className="rounded-md border border-border">
          <EmptyState
            icon="import"
            message={t.empty}
            action={
              <Button variant="primary" onClick={() => navigate('new')}>
                {t.newImport}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="rounded-md border border-border" data-testid="import-runs">
          <Table aria-label={t.runsLabel} columns={columns} rows={runs} rowKey={(r) => r.id} onRowClick={(r) => navigate(r.id)} />
        </div>
      )}
    </SettingsPage>
  );
}

export function ImportSettings() {
  return (
    <Routes>
      <Route index element={<ImportList />} />
      <Route path="new" element={<NewImportPage />} />
      <Route path=":runId" element={<ImportRunPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
