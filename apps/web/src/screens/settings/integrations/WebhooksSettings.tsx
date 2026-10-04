import { useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Button, EmptyState, Icon, InlineMessage, Skeleton, Switch, Table } from '@velocity/ui';
import type { TableColumn } from '@velocity/ui';
import { UpdateWebhookDocument, WebhooksDocument } from '@/gql/graphql';
import type { WebhookFieldsFragment } from '@/gql/graphql';
import { describeError } from '@/lib/errors';
import { useOptimisticMutation } from '@/lib/mutation';
import { NotFound } from '@/screens/workspace/NotFound';
import { m } from '@/i18n';
import { OwnerOnlyNotice, SettingsPage } from '../common';
import { WebhookDetail } from './WebhookDetail';
import { SecretModal, WebhookForm } from './WebhookForm';
import { LastDelivery, SignatureHint, useSendTest } from './webhookParts';

function EnabledSwitch({ webhook }: { webhook: WebhookFieldsFragment }) {
  const t = m.settingsIntegrations.webhooks;
  const [update] = useOptimisticMutation(UpdateWebhookDocument, {
    optimistic: (vars) => ({ __typename: 'Mutation', updateWebhook: { ...webhook, enabled: vars.input.enabled ?? webhook.enabled } }),
    rollback: () => t.flags.updateFailed,
  });
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Switch aria-label={t.enabledFor(webhook.url)} checked={webhook.enabled} onChange={(v) => void update({ id: webhook.id, input: { enabled: v } })} />
    </span>
  );
}

function WebhookList({ onCreated }: { onCreated: (id: string, secret: string) => void }) {
  const t = m.settingsIntegrations.webhooks;
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useQuery(WebhooksDocument);
  const [sendTest] = useSendTest();
  const [formOpen, setFormOpen] = useState(false);
  const rows = data?.webhooks ?? [];

  const columns: TableColumn<WebhookFieldsFragment>[] = [
    {
      key: 'url',
      header: t.columns.url,
      render: (w) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-sm text-fg" title={w.url}>
            {w.url}
          </div>
          {w.description ? <div className="truncate text-xs text-fg-subtle">{w.description}</div> : null}
        </div>
      ),
    },
    { key: 'events', header: t.columns.events, width: 96, render: (w) => <span className="text-sm text-fg-subtle">{t.eventCount(w.eventTypes.length)}</span> },
    { key: 'enabled', header: t.columns.enabled, width: 88, render: (w) => <EnabledSwitch webhook={w} /> },
    { key: 'last', header: t.columns.lastDelivery, width: 200, render: (w) => <LastDelivery webhookId={w.id} /> },
    {
      key: 'actions',
      header: <span className="sr-only">{t.columns.actions}</span>,
      headerLabel: t.columns.actions,
      width: 112,
      align: 'right',
      render: (w) => (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Button size="sm" variant="subtle" onClick={() => void sendTest(w.id)}>
            {t.sendTest}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <SettingsPage
      title={m.settings.sections.webhooks}
      description={t.description}
      wide
      testId="settings-webhooks"
      actions={
        rows.length > 0 ? (
          <Button variant="primary" iconBefore={<Icon name="add" />} onClick={() => setFormOpen(true)}>
            {t.new}
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
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-border">
          <EmptyState
            icon="webhook"
            message={t.empty}
            action={
              <Button variant="primary" onClick={() => setFormOpen(true)}>
                {t.new}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="rounded-md border border-border" data-testid="webhook-table">
          <Table aria-label={m.settings.sections.webhooks} columns={columns} rows={rows} rowKey={(w) => w.id} onRowClick={(w) => navigate(w.id)} />
        </div>
      )}
      <SignatureHint />
      <WebhookForm
        open={formOpen}
        webhook={null}
        onClose={() => setFormOpen(false)}
        onCreated={(id, s) => {
          onCreated(id, s);
          navigate(id);
        }}
      />
    </SettingsPage>
  );
}

export function WebhooksSettings() {
  // The secret modal lives above the route switch: creating a webhook navigates to its detail
  // route, which unmounts the list, so the show-once secret must be owned here (SPEC §5.4).
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <>
      <Routes>
        <Route index element={<WebhookList onCreated={(_id, s) => setSecret(s)} />} />
        <Route path=":id" element={<WebhookDetail />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <SecretModal secret={secret} title={m.settingsIntegrations.webhooks.secret.createdTitle} onClose={() => setSecret(null)} />
    </>
  );
}
