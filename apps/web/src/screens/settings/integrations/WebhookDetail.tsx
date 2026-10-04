import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Button, ConfirmDialog, EmptyState, Icon, IconButton, InlineMessage, Lozenge, Pagination, Skeleton, Switch, Table } from '@velocity/ui';
import type { TableColumn } from '@velocity/ui';
import {
  DeleteWebhookDocument,
  RedeliverWebhookDocument,
  RevealWebhookSecretDocument,
  RotateWebhookSecretDocument,
  UpdateWebhookDocument,
  WebhookDeliveriesDocument,
  WebhooksDocument,
} from '@/gql/graphql';
import type { WebhookDeliveriesQuery } from '@/gql/graphql';
import { describeError } from '@/lib/errors';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';
import { OwnerOnlyNotice, SectionBody, SettingsPage, SettingsRow, SettingsSection } from '../common';
import { CodeBlock, CopyField } from './shared';
import { SecretModal, WebhookForm } from './WebhookForm';
import { DeliveryStatus, SignatureHint, eventLabel, useSendTest } from './webhookParts';

type Delivery = WebhookDeliveriesQuery['webhookDeliveries']['nodes'][number];

const PAGE_SIZE = 20;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function DeliveryDetail({ delivery }: { delivery: Delivery }) {
  const t = m.settingsIntegrations.webhooks.deliveries;
  const body = JSON.stringify(delivery.payload, null, 2);
  return (
    <div className="grid gap-4 border-t border-border bg-sunken p-4 md:grid-cols-2" data-testid="delivery-detail">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-sm font-semibold text-fg">{t.request}</h3>
        <p className="text-xs text-fg-subtle">
          <code className="font-mono">POST</code> · <code className="font-mono">X-Velocity-Event: {delivery.eventType}</code>
        </p>
        <CodeBlock code={body} what={t.request} label={t.request} />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-sm font-semibold text-fg">{t.response}</h3>
        <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-fg-subtle">{t.columns.statusCode}</dt>
          <dd className="font-mono text-fg">{delivery.statusCode ?? t.none}</dd>
          <dt className="text-fg-subtle">{t.columns.duration}</dt>
          <dd className="font-mono text-fg">{delivery.durationMs !== null ? `${delivery.durationMs} ms` : t.none}</dd>
          <dt className="text-fg-subtle">{t.delivered}</dt>
          <dd className="text-fg">{delivery.deliveredAt ? formatDateTime(delivery.deliveredAt) : t.none}</dd>
          <dt className="text-fg-subtle">{t.error}</dt>
          <dd className="break-words font-mono text-fg">{delivery.error ?? t.none}</dd>
        </dl>
        <p className="mt-1 text-xs text-fg-subtlest">{t.responseBodyNote}</p>
      </div>
    </div>
  );
}

export function WebhookDetail() {
  const t = m.settingsIntegrations.webhooks;
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [sendTest, testing] = useSendTest();

  const { data, loading, error, refetch } = useQuery(WebhookDeliveriesDocument, {
    variables: { webhookId: id, first: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
    notifyOnNetworkStatusChange: true,
  });
  const webhook = data?.webhook;

  const [update] = useOptimisticMutation(UpdateWebhookDocument, {
    optimistic: (vars) => ({ __typename: 'Mutation', updateWebhook: { ...(webhook as NonNullable<typeof webhook>), enabled: vars.input.enabled ?? webhook?.enabled ?? true } }),
    rollback: () => t.flags.updateFailed,
  });
  const [remove, removeState] = useOptimisticMutation(DeleteWebhookDocument, {
    optimistic: { serverConfirmed: 'Navigation follows the server confirming the delete.' },
    rollback: () => t.flags.deleteFailed,
    refetchQueries: [WebhooksDocument],
  });
  const [reveal, revealState] = useOptimisticMutation(RevealWebhookSecretDocument, {
    optimistic: { serverConfirmed: 'The secret is only known to the server.' },
    rollback: () => t.flags.revealFailed,
  });
  const [rotate, rotateState] = useOptimisticMutation(RotateWebhookSecretDocument, {
    optimistic: { serverConfirmed: 'The server mints the new secret.' },
    rollback: () => t.flags.rotateFailed,
  });
  const [redeliver] = useOptimisticMutation(RedeliverWebhookDocument, {
    optimistic: { serverConfirmed: 'A redelivery is a new HTTP attempt performed by the server.' },
    rollback: () => t.flags.redeliverFailed,
    refetchQueries: [WebhookDeliveriesDocument],
  });

  const total = data?.webhookDeliveries.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const nodes = data?.webhookDeliveries.nodes ?? [];
  const expandedRow = nodes.find((d) => d.id === expanded) ?? null;

  const columns: TableColumn<Delivery>[] = [
    {
      key: 'toggle',
      header: <span className="sr-only">{t.deliveries.columns.expand}</span>,
      headerLabel: t.deliveries.columns.expand,
      width: 40,
      render: (d) => (
        <Icon name={expanded === d.id ? 'chevron-down' : 'chevron-right'} className="text-fg-subtle" />
      ),
    },
    { key: 'time', header: t.deliveries.columns.time, width: 168, render: (d) => <span className="text-sm text-fg" title={formatDateTime(d.createdAt)}>{formatDateTime(d.createdAt)}</span> },
    { key: 'event', header: t.deliveries.columns.event, render: (d) => <span title={eventLabel(d.eventType)}><code className="font-mono text-sm text-fg">{d.eventType}</code></span> },
    { key: 'status', header: t.deliveries.columns.status, width: 120, render: (d) => <DeliveryStatus status={d.status} /> },
    { key: 'code', header: t.deliveries.columns.statusCode, width: 64, render: (d) => <span className="font-mono text-sm text-fg">{d.statusCode ?? t.deliveries.none}</span> },
    { key: 'attempt', header: t.deliveries.columns.attempt, width: 72, render: (d) => <span className="text-sm text-fg-subtle">{d.attempt}</span> },
    { key: 'duration', header: t.deliveries.columns.duration, width: 80, render: (d) => <span className="font-mono text-sm text-fg-subtle">{d.durationMs !== null ? `${d.durationMs} ms` : t.deliveries.none}</span> },
    {
      key: 'retry',
      header: t.deliveries.columns.nextRetry,
      width: 112,
      render: (d) => <span className="text-sm text-fg-subtle">{d.nextRetryAt ? formatRelative(d.nextRetryAt) : t.deliveries.none}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t.columns.actions}</span>,
      headerLabel: t.columns.actions,
      width: 104,
      align: 'right',
      render: (d) => (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Button size="sm" variant="subtle" onClick={() => void redeliver({ deliveryId: d.id })}>
            {t.deliveries.redeliver}
          </Button>
        </span>
      ),
    },
  ];

  const parents = [{ label: m.settings.sections.webhooks, to: '/settings/webhooks' }];

  if (loading && !data) {
    return (
      <SettingsPage title={m.settings.sections.webhooks} parents={[]} wide>
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </SettingsPage>
    );
  }
  if (error || !webhook) {
    return (
      <SettingsPage title={m.settings.sections.webhooks} wide>
        <InlineMessage appearance="error" action={<Button size="sm" onClick={() => void refetch()}>{m.common.retry}</Button>}>
          {describeError(error).message}
        </InlineMessage>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      title={hostOf(webhook.url)}
      parents={parents}
      wide
      testId="settings-webhook-detail"
      actions={
        <>
          <Button onClick={() => setEditing(true)}>{m.common.edit}</Button>
          <Button loading={testing} onClick={() => void sendTest(webhook.id)}>
            {t.sendTest}
          </Button>
        </>
      }
    >
      <OwnerOnlyNotice />
      <SettingsSection title={t.detail.overview}>
        <SettingsRow label={t.form.url}>
          <CopyField value={webhook.url} what={t.form.url} className="w-96 max-w-full" testId="webhook-url" />
        </SettingsRow>
        <SettingsRow label={t.detail.enabled} description={t.detail.enabledHelp}>
          <Switch aria-label={t.detail.enabled} checked={webhook.enabled} onChange={(v) => void update({ id: webhook.id, input: { enabled: v } })} />
        </SettingsRow>
        <SettingsRow label={t.form.events} description={t.eventCount(webhook.eventTypes.length)}>
          <div className="flex max-w-md flex-wrap justify-end gap-1">
            {webhook.eventTypes.map((e) => (
              <Lozenge key={e}>
                <span className="font-mono">{e}</span>
              </Lozenge>
            ))}
          </div>
        </SettingsRow>
        {webhook.description ? (
          <SettingsRow label={t.form.description}>
            <span className="text-sm text-fg">{webhook.description}</span>
          </SettingsRow>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t.secret.title} description={t.secret.help}>
        <SectionBody className="flex flex-wrap items-center gap-2">
          <Button
            loading={revealState.loading}
            onClick={() => void reveal({ id: webhook.id }).then(({ data: d }) => d && setSecret({ title: t.secret.revealedTitle, value: d.revealWebhookSecret }))}
          >
            {t.secret.reveal}
          </Button>
          <Button onClick={() => setConfirmRotate(true)}>{t.secret.rotate}</Button>
        </SectionBody>
      </SettingsSection>

      <SettingsSection
        title={t.deliveries.title}
        description={t.deliveries.help}
        actions={<IconButton label={t.deliveries.refresh} icon={<Icon name="refresh" />} onClick={() => void refetch()} />}
      >
        {nodes.length === 0 && !loading ? (
          <EmptyState icon="webhook" message={t.deliveries.empty} action={<Button onClick={() => void sendTest(webhook.id)}>{t.sendTest}</Button>} />
        ) : (
          <div data-testid="delivery-table">
            <Table
              aria-label={t.deliveries.title}
              columns={columns}
              rows={nodes}
              rowKey={(d) => d.id}
              selectedKeys={expanded ? [expanded] : []}
              onRowClick={(d) => setExpanded((cur) => (cur === d.id ? null : d.id))}
              stickyHeader={false}
            />
            {expandedRow ? <DeliveryDetail delivery={expandedRow} /> : null}
            <div className="flex items-center justify-between border-t border-border px-4 py-2">
              <span className="text-sm text-fg-subtle">{t.deliveries.range(total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1, Math.min(page * PAGE_SIZE, total), total)}</span>
              {pageCount > 1 ? (
                <Pagination
                  page={Math.min(page, pageCount)}
                  pageCount={pageCount}
                  onPageChange={(p) => {
                    setExpanded(null);
                    setParams(p === 1 ? {} : { page: String(p) });
                  }}
                />
              ) : null}
            </div>
          </div>
        )}
      </SettingsSection>

      <SignatureHint />

      <SettingsSection title={t.detail.danger} danger>
        <SettingsRow label={t.detail.delete} description={t.detail.deleteHelp}>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            {t.detail.delete}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <WebhookForm open={editing} webhook={webhook} onClose={() => setEditing(false)} />
      <SecretModal secret={secret?.value ?? null} title={secret?.title ?? ''} onClose={() => setSecret(null)} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t.detail.deleteTitle}
        description={t.detail.deleteBody}
        confirmLabel={t.detail.delete}
        loading={removeState.loading}
        onConfirm={() => void remove({ id: webhook.id }).then(({ error: err }) => !err && navigate('/settings/webhooks'))}
      />
      <ConfirmDialog
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        title={t.secret.rotateTitle}
        description={t.secret.rotateBody}
        confirmLabel={t.secret.rotate}
        destructive={false}
        loading={rotateState.loading}
        onConfirm={() =>
          void rotate({ id: webhook.id }).then(({ data: d }) => {
            setConfirmRotate(false);
            if (d) setSecret({ title: t.secret.rotatedTitle, value: d.rotateWebhookSecret });
          })
        }
      />
    </SettingsPage>
  );
}
