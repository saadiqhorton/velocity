import { useQuery } from '@apollo/client';
import { Lozenge, Skeleton, useFlags } from '@velocity/ui';
import { TestWebhookDocument, WebhookDeliveriesDocument } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { SectionBody, SettingsSection } from '../common';
import { CodeBlock } from './shared';
import { formatRelative } from '@/lib/format';
import { m } from '@/i18n';

/** Event types the server accepts (packages/schema WEBHOOK_EVENT_TYPES), grouped by entity. */
export const EVENT_GROUPS: { id: 'issue' | 'comment' | 'cycle' | 'project' | 'import'; events: string[] }[] = [
  { id: 'issue', events: ['issue.created', 'issue.updated', 'issue.status_changed', 'issue.assigned'] },
  { id: 'comment', events: ['comment.created'] },
  { id: 'cycle', events: ['cycle.started', 'cycle.closed'] },
  { id: 'project', events: ['project.updated'] },
  { id: 'import', events: ['import.completed'] },
];

export const ALL_EVENTS = EVENT_GROUPS.flatMap((g) => g.events);

export function eventLabel(event: string): string {
  const labels = m.settingsIntegrations.webhooks.eventLabels as Record<string, string>;
  return labels[event] ?? event;
}

export function DeliveryStatus({ status }: { status: string }) {
  const t = m.settingsIntegrations.webhooks.status;
  const color = status === 'success' ? 'green' : status === 'dead' ? 'red' : status === 'failed' ? 'yellow' : 'grey';
  const label = status in t ? t[status as keyof typeof t] : status;
  return <Lozenge color={color}>{label}</Lozenge>;
}

/** Status of the most recent delivery of one webhook (list column). */
export function LastDelivery({ webhookId }: { webhookId: string }) {
  const { data, loading } = useQuery(WebhookDeliveriesDocument, { variables: { webhookId, first: 1, offset: 0 } });
  const last = data?.webhookDeliveries.nodes[0];
  if (loading && !data) return <Skeleton className="h-4 w-20" />;
  if (!last) return <span className="text-sm text-fg-subtlest">{m.settingsIntegrations.webhooks.noDeliveries}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <DeliveryStatus status={last.status} />
      <span className="text-sm text-fg-subtle">{formatRelative(last.createdAt)}</span>
    </span>
  );
}

export const SIGNATURE_HEADER = 'X-Velocity-Signature';

export function SignatureHint() {
  const t = m.settingsIntegrations.webhooks.signature;
  return (
    <SettingsSection title={t.title} description={t.help}>
      <SectionBody className="flex flex-col gap-3">
        <CodeBlock
          code={`${SIGNATURE_HEADER}: sha256=<hex>\n<hex> = HMAC_SHA256(secret, raw_request_body)`}
          what={t.header}
          label={t.title}
          testId="webhook-signature"
        />
        <p className="text-sm text-fg-subtle">{t.verify}</p>
      </SectionBody>
    </SettingsSection>
  );
}

/** Hook shared by list rows and the detail page: send one test delivery and report the result. */
export function useSendTest(): [(id: string) => Promise<void>, boolean] {
  const t = m.settingsIntegrations.webhooks;
  const { showFlag } = useFlags();
  const [send, { loading }] = useOptimisticMutation(TestWebhookDocument, {
    optimistic: { serverConfirmed: 'The server performs the HTTP delivery and reports the outcome.' },
    rollback: () => t.flags.testFailed,
    refetchQueries: [WebhookDeliveriesDocument],
  });
  return [
    async (id: string) => {
      const { data } = await send({ id });
      const d = data?.testWebhook;
      if (!d) return;
      showFlag({
        title: d.status === 'success' ? t.flags.testOk : t.flags.testResult(d.status),
        description: d.statusCode ? t.flags.statusCode(d.statusCode) : undefined,
        severity: d.status === 'success' ? 'success' : 'warning',
      });
    },
    loading,
  ];
}

