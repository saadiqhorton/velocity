import { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import { Banner, Button, Modal, Select, Skeleton, TextField } from '@velocity/ui';
import {
  CancelWorkspaceDeletionDocument,
  RequestWorkspaceDeletionDocument,
  UpdateWorkspaceDocument,
  WorkspaceSettingsDocument,
} from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { formatDate } from '@/lib/format';
import { describeError } from '@/lib/errors';
import { SectionBody, SettingsPage, SettingsRow, SettingsSection } from '../common';
import { SavedMark, timeZones, useSavedFlag } from './shared';
import { m } from '@/i18n';

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function GeneralSettings() {
  const { data, loading, error } = useQuery(WorkspaceSettingsDocument);
  const ws = data?.workspace;
  return (
    <SettingsPage title={m.settings.sections.general} testId="settings-general">
      {error ? (
        <Banner appearance="error">{describeError(error).message}</Banner>
      ) : loading || !ws ? (
        <div className="flex flex-col gap-3" role="status" aria-label={m.common.loading}>
          <Skeleton height={32} />
          <Skeleton height={32} />
          <Skeleton height={32} />
        </div>
      ) : (
        <>
          <WorkspaceForm ws={ws} />
          <DangerZone name={ws.name} scheduledFor={ws.deletionScheduledFor ?? null} />
        </>
      )}
    </SettingsPage>
  );
}

interface WsValues {
  name: string;
  slug: string;
  timezone: string;
  locale: string;
}

function WorkspaceForm({ ws }: { ws: WsValues }) {
  const t = m.settingsWorkspace.general;
  const [name, setName] = useState(ws.name);
  const [slug, setSlug] = useState(ws.slug);
  const [timezone, setTimezone] = useState(ws.timezone);
  const [locale, setLocale] = useState(ws.locale);
  const [saved, flash] = useSavedFlag();
  const zones = useMemo(() => timeZones(ws.timezone), [ws.timezone]);
  const [update, { loading }] = useOptimisticMutation(UpdateWorkspaceDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      updateWorkspace: {
        __typename: 'Workspace' as const,
        name: vars.input.name ?? ws.name,
        slug: vars.input.slug ?? ws.slug,
        timezone: vars.input.timezone ?? ws.timezone,
        locale: vars.input.locale ?? ws.locale,
      },
    }),
    rollback: () => m.settingsWorkspace.saveFailed,
    refetchQueries: ['Bootstrap', 'WorkspaceSettings'],
  });

  const nameTrim = name.trim();
  const slugValid = SLUG_PATTERN.test(slug);
  const dirty = nameTrim !== ws.name || slug !== ws.slug || timezone !== ws.timezone || locale !== ws.locale;
  const valid = nameTrim.length > 0 && slugValid;

  const save = async () => {
    if (!valid || !dirty) return;
    const res = await update({ input: { name: nameTrim, slug, timezone, locale } });
    if (res.data) flash();
  };

  return (
    <SettingsSection title={t.workspaceSection} description={t.workspaceDescription} testId="general-form">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <SettingsRow label={t.name} description={t.nameHelp} htmlFor="ws-name">
          <div className="w-72">
            <TextField id="ws-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} invalid={nameTrim.length === 0} />
          </div>
        </SettingsRow>
        <SettingsRow label={t.slug} description={slugValid ? t.slugHelp : <span className="text-danger-fg">{t.slugInvalid}</span>} htmlFor="ws-slug">
          <div className="w-72">
            <TextField id="ws-slug" value={slug} className="font-mono" invalid={!slugValid} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
          </div>
        </SettingsRow>
        <SettingsRow label={t.timezone} description={t.timezoneHelp} htmlFor="ws-tz">
          <div className="w-72">
            <Select id="ws-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} options={zones.map((z) => ({ value: z, label: z }))} />
          </div>
        </SettingsRow>
        <SettingsRow label={t.locale} description={t.localeHelp} htmlFor="ws-locale">
          <div className="w-72">
            <Select id="ws-locale" value={locale} onChange={(e) => setLocale(e.target.value)} options={[{ value: 'en', label: t.localeEnglish }]} />
          </div>
        </SettingsRow>
        <SectionBody className="flex items-center justify-end gap-3 border-t border-border">
          <SavedMark show={saved} />
          <Button type="submit" variant="primary" loading={loading} disabled={!dirty || !valid}>
            {t.save}
          </Button>
        </SectionBody>
      </form>
    </SettingsSection>
  );
}

function DangerZone({ name, scheduledFor }: { name: string; scheduledFor: string | null }) {
  const t = m.settingsWorkspace.general;
  const [open, setOpen] = useState(false);

  const [cancel, { loading: canceling }] = useOptimisticMutation(CancelWorkspaceDeletionDocument, {
    optimistic: () => ({
      __typename: 'Mutation' as const,
      cancelWorkspaceDeletion: { __typename: 'Workspace' as const, name, deletionRequestedAt: null, deletionScheduledFor: null },
    }),
    rollback: () => m.settingsWorkspace.saveFailed,
    refetchQueries: ['Bootstrap', 'WorkspaceSettings'],
  });

  return (
    <SettingsSection title={t.dangerSection} description={t.dangerDescription} danger testId="general-danger">
      {scheduledFor ? (
        <SettingsRow label={t.scheduledTitle} description={t.scheduledBody(formatDate(scheduledFor))}>
          <Button loading={canceling} onClick={() => void cancel({})}>
            {t.cancelDeletion}
          </Button>
        </SettingsRow>
      ) : (
        <SettingsRow label={t.deleteRow} description={t.deleteRowHelp}>
          <Button variant="danger" onClick={() => setOpen(true)}>
            {t.deleteButton}
          </Button>
        </SettingsRow>
      )}
      {open ? <DeleteModal name={name} onClose={() => setOpen(false)} /> : null}
    </SettingsSection>
  );
}

function DeleteModal({ name, onClose }: { name: string; onClose: () => void }) {
  const t = m.settingsWorkspace.general;
  const [confirm, setConfirm] = useState('');
  const [request, { loading: requesting }] = useOptimisticMutation(RequestWorkspaceDeletionDocument, {
    optimistic: { serverConfirmed: 'The server computes the deletion date (7 days from now).' },
    rollback: () => m.settingsWorkspace.saveFailed,
    refetchQueries: ['Bootstrap', 'WorkspaceSettings'],
  });
  const submit = async () => {
    if (confirm !== name) return;
    const res = await request({ confirmName: confirm });
    if (res.data) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t.deleteTitle}
      description={t.deleteBody}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{m.common.cancel}</Button>
          <Button variant="danger" loading={requesting} disabled={confirm !== name} onClick={() => void submit()}>
            {t.deleteConfirm}
          </Button>
        </>
      }
    >
      <TextField label={t.deleteConfirmLabel(name)} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" data-autofocus />
    </Modal>
  );
}
