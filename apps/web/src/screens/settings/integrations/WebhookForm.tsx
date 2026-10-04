import { useMemo, useState } from 'react';
import { Button, Checkbox, Field, InlineMessage, Modal, TextField } from '@velocity/ui';
import { CreateWebhookDocument, UpdateWebhookDocument, WebhooksDocument } from '@/gql/graphql';
import type { WebhookFieldsFragment } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';
import { CopyField } from './shared';
import { ALL_EVENTS, EVENT_GROUPS, eventLabel } from './webhookParts';

function validUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export interface WebhookFormProps {
  open: boolean;
  /** Null creates a new webhook. */
  webhook: WebhookFieldsFragment | null;
  onClose: () => void;
  /** Called after a successful create with the new id and secret. */
  onCreated?: (id: string, secret: string) => void;
}

/** The body mounts only while the modal is open, so each open starts from the webhook's current values. */
export function WebhookForm(props: WebhookFormProps) {
  return props.open ? <WebhookFormBody {...props} /> : null;
}

function WebhookFormBody({ open, webhook, onClose, onCreated }: WebhookFormProps) {
  const t = m.settingsIntegrations.webhooks;
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [description, setDescription] = useState(webhook?.description ?? '');
  const [events, setEvents] = useState<string[]>(webhook ? [...webhook.eventTypes] : [...ALL_EVENTS]);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [create, createState] = useOptimisticMutation(CreateWebhookDocument, {
    optimistic: { serverConfirmed: 'The server mints the signing secret and the id.' },
    rollback: () => t.flags.createFailed,
    silent: true,
    refetchQueries: [WebhooksDocument],
  });
  const [update, updateState] = useOptimisticMutation(UpdateWebhookDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation',
      updateWebhook: {
        ...(webhook as WebhookFieldsFragment),
        url: vars.input.url ?? (webhook?.url as string),
        description: vars.input.description ?? null,
        eventTypes: vars.input.eventTypes ?? (webhook?.eventTypes as string[]),
      },
    }),
    rollback: () => t.flags.updateFailed,
    silent: true,
  });

  const urlError = touched && !validUrl(url) ? t.form.urlInvalid : undefined;
  const eventsError = touched && events.length === 0 ? t.form.eventsRequired : undefined;
  const dirty = useMemo(
    () =>
      webhook
        ? url !== webhook.url || description !== (webhook.description ?? '') || events.slice().sort().join() !== webhook.eventTypes.slice().sort().join()
        : url !== '' || description !== '',
    [url, description, events, webhook],
  );

  const toggle = (event: string, on: boolean) => setEvents((cur) => (on ? [...cur, event] : cur.filter((e) => e !== event)));

  const submit = async () => {
    setTouched(true);
    if (!validUrl(url) || events.length === 0) return;
    setError(null);
    const input = { url: url.trim(), description: description.trim() || null, eventTypes: events };
    if (webhook) {
      const { error: err } = await update({ id: webhook.id, input });
      if (err) setError(err.message);
      else onClose();
    } else {
      const { data, error: err } = await create({ input });
      if (err) setError(err.message);
      else if (data) {
        onClose();
        onCreated?.(data.createWebhook.webhook.id, data.createWebhook.secret);
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={webhook ? t.form.editTitle : t.form.createTitle}
      isDirty={dirty}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{m.common.cancel}</Button>
          <Button variant="primary" loading={createState.loading || updateState.loading} onClick={() => void submit()}>
            {webhook ? m.common.save : t.form.create}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <InlineMessage appearance="error">{error}</InlineMessage> : null}
        <Field label={t.form.url} helperText={t.form.urlHelp} error={urlError} required>
          <TextField
            data-autofocus
            className="font-mono"
            value={url}
            placeholder="https://example.com/hooks/velocity"
            inputMode="url"
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>
        <Field label={t.form.description}>
          <TextField value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-fg">{t.form.events}</legend>
          <div className="flex flex-col gap-3 rounded-md border border-border p-3">
            {EVENT_GROUPS.map((g) => {
              const selected = g.events.filter((e) => events.includes(e));
              return (
                <div key={g.id} className="flex flex-col gap-1">
                  {g.events.length > 1 ? (
                    <Checkbox
                      label={<span className="font-medium">{t.groups[g.id]}</span>}
                      checked={selected.length === g.events.length}
                      indeterminate={selected.length > 0 && selected.length < g.events.length}
                      onChange={(e) =>
                        setEvents((cur) => {
                          const rest = cur.filter((x) => !g.events.includes(x));
                          return e.target.checked ? [...rest, ...g.events] : rest;
                        })
                      }
                    />
                  ) : null}
                  <div className={g.events.length > 1 ? 'flex flex-col gap-1 pl-6' : 'flex flex-col gap-1'}>
                    {g.events.map((event) => (
                      <Checkbox
                        key={event}
                        label={
                          <span className="inline-flex items-baseline gap-2">
                            {eventLabel(event)}
                            <code className="font-mono text-xs text-fg-subtlest">{event}</code>
                          </span>
                        }
                        checked={events.includes(event)}
                        onChange={(e) => toggle(event, e.target.checked)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {eventsError ? <p className="text-sm text-danger-fg" role="alert">{eventsError}</p> : null}
        </fieldset>
      </div>
    </Modal>
  );
}

/** Shows a signing secret right after creation or rotation. */
export function SecretModal({ secret, title, onClose }: { secret: string | null; title: string; onClose: () => void }) {
  const t = m.settingsIntegrations.webhooks;
  return (
    <Modal
      open={secret !== null}
      onClose={onClose}
      size="md"
      title={title}
      description={t.secret.shownHelp}
      footer={
        <Button variant="primary" onClick={onClose}>
          {m.common.done}
        </Button>
      }
    >
      {secret ? <CopyField value={secret} what={t.secret.label} testId="webhook-secret" /> : null}
    </Modal>
  );
}
