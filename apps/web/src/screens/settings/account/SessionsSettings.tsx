import { useState } from 'react';
import { useQuery } from '@apollo/client';
import { Button, ConfirmDialog, EmptyState, InlineMessage, Lozenge, Skeleton, Table, Tooltip } from '@velocity/ui';
import type { TableColumn } from '@velocity/ui';
import { RevokeOtherSessionsDocument, RevokeSessionDocument, SessionsDocument } from '@/gql/graphql';
import type { SessionsQuery } from '@/gql/graphql';
import { useFlags } from '@velocity/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';
import { SettingsPage, SettingsSection } from '../common';
import { describeUserAgent } from './ua';

type Row = SessionsQuery['sessions'][number];

export function SessionsSettings() {
  const t = m.settingsAccount.sessions;
  const { showFlag } = useFlags();
  const { data, loading, error } = useQuery(SessionsDocument);
  const [confirmOthers, setConfirmOthers] = useState(false);

  const [revoke] = useOptimisticMutation(RevokeSessionDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, revokeSession: true }),
    update: (cache, _res, vars) => {
      cache.evict({ id: cache.identify({ __typename: 'Session', id: vars.id }) });
      cache.gc();
    },
    rollback: () => t.revokeFailed,
  });
  const [revokeOthers, { loading: revokingOthers }] = useOptimisticMutation(RevokeOtherSessionsDocument, {
    optimistic: { serverConfirmed: 'Which sessions exist is decided by the server.' },
    refetchQueries: [SessionsDocument],
    rollback: () => t.revokeOthersFailed,
  });

  const rows = data?.sessions ?? [];
  const others = rows.filter((s) => !s.current).length;

  const columns: TableColumn<Row>[] = [
    {
      key: 'device',
      header: t.device,
      render: (s) => (
        <span className="flex items-center gap-2">
          <span className="truncate text-fg">{describeUserAgent(s.userAgent)}</span>
          {s.current ? <Lozenge appearance="success">{t.current}</Lozenge> : null}
        </span>
      ),
    },
    { key: 'ip', header: t.ip, width: 140, render: (s) => <span className="identifier">{s.ip ?? '–'}</span> },
    {
      key: 'created',
      header: t.created,
      width: 136,
      render: (s) => (
        <Tooltip content={formatDateTime(s.createdAt)}>
          <span className="whitespace-nowrap text-fg-subtle">{formatRelative(s.createdAt)}</span>
        </Tooltip>
      ),
    },
    {
      key: 'lastUsed',
      header: t.lastUsed,
      width: 136,
      render: (s) => (
        <Tooltip content={s.lastUsedAt ? formatDateTime(s.lastUsedAt) : m.time.never}>
          <span className="whitespace-nowrap text-fg-subtle">{formatRelative(s.lastUsedAt)}</span>
        </Tooltip>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{m.common.more}</span>,
      width: 96,
      align: 'right',
      render: (s) =>
        s.current ? null : (
          <Button size="sm" variant="subtle" aria-label={t.revokeLabel(describeUserAgent(s.userAgent))} onClick={() => void revoke({ id: s.id }).then((r) => !r.error && showFlag({ title: t.revoked, severity: 'success' }))}>
            {t.revoke}
          </Button>
        ),
    },
  ];

  return (
    <SettingsPage
      title={m.settings.sections.sessions}
      description={t.description}
      wide
      testId="settings-sessions"
      actions={
        <Button disabled={others === 0} onClick={() => setConfirmOthers(true)}>
          {t.revokeOthers}
        </Button>
      }
    >
      <SettingsSection title={m.settings.sections.sessions}>
        {loading && !data ? (
          <div className="p-4"><Skeleton height={32} rows={3} /></div>
        ) : error ? (
          <div className="p-4">
            <InlineMessage appearance="error">{t.loadFailed}</InlineMessage>
          </div>
        ) : (
          <Table aria-label={t.table} columns={columns} rows={rows} rowKey={(s) => s.id} emptyState={<EmptyState message={t.empty} />} />
        )}
      </SettingsSection>
      <ConfirmDialog
        open={confirmOthers}
        onClose={() => setConfirmOthers(false)}
        title={t.revokeOthersTitle}
        description={t.revokeOthersBody}
        confirmLabel={t.revokeOthers}
        cancelLabel={m.common.cancel}
        loading={revokingOthers}
        onConfirm={() =>
          void revokeOthers({}).then((r) => {
            setConfirmOthers(false);
            if (!r.error) showFlag({ title: t.revokeOthersDone, severity: 'success' });
          })
        }
      />
    </SettingsPage>
  );
}
