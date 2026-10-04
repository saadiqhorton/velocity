import { useState } from 'react';
import { useQuery } from '@apollo/client';
import { Avatar, Button, EmptyState, InlineMessage, Pagination, Select, Skeleton, Table, Tooltip } from '@velocity/ui';
import type { TableColumn } from '@velocity/ui';
import { AuditLogDocument } from '@/gql/graphql';
import type { AuditLogQuery } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { formatDateTime, formatRelative } from '@/lib/format';
import { m } from '@/i18n';
import { OwnerOnlyNotice, SettingsPage, useIsOwner } from '../common';

type Row = AuditLogQuery['auditLog']['nodes'][number];

const PAGE_SIZE = 20;
const HOUR_MS = 3_600_000;
const PRESETS: Record<string, number> = { '24h': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS, '30d': 30 * 24 * HOUR_MS };

function actionLabel(action: string): string {
  return m.settingsAccount.audit.actions[action] ?? action;
}

function Target({ row }: { row: Row }) {
  if (!row.objectType) return <span className="text-fg-subtlest">–</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="text-fg-subtle">{row.objectType}</span>
      {row.objectId ? <span className="identifier max-w-32 truncate" title={row.objectId}>{row.objectId}</span> : null}
    </span>
  );
}

export function AuditSettings() {
  const t = m.settingsAccount.audit;
  const isOwner = useIsOwner();
  const { users } = useWorkspace();
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [range, setRange] = useState('');
  const [page, setPage] = useState(1);
  // Reference time for date presets; refreshed whenever the preset changes so "last 24h" is exact.
  const [now, setNow] = useState(() => Date.now());

  const after = range ? new Date(now - (PRESETS[range] ?? 0)).toISOString() : undefined;
  const { data, loading, error } = useQuery(AuditLogDocument, {
    skip: !isOwner,
    variables: {
      first: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      action: action || undefined,
      actorUserId: actor || undefined,
      after,
    },
  });

  const rows = data?.auditLog.nodes ?? [];
  const total = data?.auditLog.totalCount ?? 0;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const filtered = action !== '' || actor !== '' || range !== '';

  const apiKeyPrefix = (id: string) => id.slice(0, 8);
  const columns: TableColumn<Row>[] = [
    {
      key: 'time',
      header: t.time,
      width: 120,
      render: (r) => (
        <Tooltip content={formatDateTime(r.createdAt)}>
          <span className="whitespace-nowrap text-fg-subtle">{formatRelative(r.createdAt)}</span>
        </Tooltip>
      ),
    },
    {
      key: 'actor',
      header: t.actor,
      width: 180,
      render: (r) =>
        r.actor ? (
          <span className="flex items-center gap-2">
            <Avatar name={r.actor.name} size={20} />
            <span className="truncate text-fg">{r.actor.name}</span>
          </span>
        ) : r.actorApiKeyId ? (
          <span className="text-fg-subtle">{t.apiKey(apiKeyPrefix(r.actorApiKeyId))}</span>
        ) : r.actorMcpSessionId ? (
          <span className="text-fg-subtle">{t.mcp}</span>
        ) : (
          <span className="text-fg-subtle">{t.system}</span>
        ),
    },
    {
      key: 'action',
      header: t.action,
      render: (r) => (
        <span className="flex flex-col leading-tight">
          <span className="text-fg">{actionLabel(r.action)}</span>
          <span className="identifier">{r.action}</span>
        </span>
      ),
    },
    { key: 'target', header: t.target, render: (r) => <Target row={r} /> },
    { key: 'ip', header: t.ip, width: 130, render: (r) => <span className="identifier">{r.ip ?? '–'}</span> },
  ];

  const actionOptions = [{ value: '', label: t.allActions }, ...Object.keys(m.settingsAccount.audit.actions).map((a) => ({ value: a, label: actionLabel(a) }))];
  const actorOptions = [{ value: '', label: t.allActors }, ...users.filter((u) => !u.removed).map((u) => ({ value: u.id, label: u.name }))];
  const rangeOptions = [
    { value: '', label: t.anyTime },
    { value: '24h', label: t.last24h },
    { value: '7d', label: t.last7d },
    { value: '30d', label: t.last30d },
  ];

  const change = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };

  return (
    <SettingsPage title={m.settings.sections.audit} description={t.description} wide testId="settings-audit">
      <OwnerOnlyNotice />
      {isOwner ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <Select label={t.filterAction} value={action} onChange={(e) => change(setAction)(e.target.value)} options={actionOptions} id="audit-action" />
            </div>
            <div className="w-48">
              <Select label={t.filterActor} value={actor} onChange={(e) => change(setActor)(e.target.value)} options={actorOptions} id="audit-actor" />
            </div>
            <div className="w-44">
              <Select label={t.filterDate} value={range} onChange={(e) => {
                  setNow(Date.now());
                  change(setRange)(e.target.value);
                }} options={rangeOptions} id="audit-range" />
            </div>
            {filtered ? (
              <Button
                variant="subtle"
                onClick={() => {
                  setAction('');
                  setActor('');
                  setRange('');
                  setPage(1);
                }}
              >
                {t.clear}
              </Button>
            ) : null}
          </div>
          <div className="rounded-md border border-border">
            {loading && !data ? (
              <div className="p-4"><Skeleton height={32} rows={6} /></div>
            ) : error ? (
              <div className="p-4">
                <InlineMessage appearance="error">{t.loadFailed}</InlineMessage>
              </div>
            ) : (
              <Table aria-label={t.table} columns={columns} rows={rows} rowKey={(r) => r.id} emptyState={<EmptyState message={t.empty} />} />
            )}
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-fg-subtle">{t.range(from, to, total)}</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </div>
        </div>
      ) : null}
    </SettingsPage>
  );
}
