import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Avatar, Button, InlineMessage, Radio, RadioGroup, TextField } from '@velocity/ui';
import { ChangePasswordDocument, RemoveAvatarDocument, UpdateProfileDocument, UploadAvatarDocument } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useSetTheme } from '@/components/shell/theme';
import { useOptimisticMutation } from '@/lib/mutation';
import { useTheme } from '@/stores/theme';
import type { ThemePref } from '@/stores/theme';
import { m } from '@/i18n';
import { SectionBody, SettingsPage, SettingsRow, SettingsSection } from '../common';

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MIN_PASSWORD = 10;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AvatarSection() {
  const t = m.settingsAccount.profile;
  const { viewer } = useWorkspace();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upload, { loading }] = useOptimisticMutation(UploadAvatarDocument, {
    optimistic: { serverConfirmed: 'The avatar URL is minted by the server after the image is processed.' },
    rollback: () => t.uploadFailed,
  });
  const [remove, { loading: removing }] = useOptimisticMutation(RemoveAvatarDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, removeAvatar: { __typename: 'User' as const, id: viewer.id, avatarUrl: null } }),
    rollback: () => t.removeFailed,
  });

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) {
      setError(t.badType);
      return;
    }
    setError(null);
    setPreview(URL.createObjectURL(file));
    const { error: err } = await upload({ file });
    // Once the server URL is in the cache the preview is no longer needed.
    setPreview(null);
    if (err) setError(err.message);
  };

  const onRemove = async () => {
    setError(null);
    const { error: err } = await remove({});
    if (err) setError(err.message);
  };

  return (
    <SettingsSection title={t.avatarTitle}>
      <SettingsRow label={viewer.name} description={error ? <span className="text-danger-fg">{error}</span> : t.avatarHelp}>
        <Avatar name={viewer.name} src={preview ?? viewer.avatarUrl} size={32} />
        <input ref={inputRef} type="file" accept={AVATAR_TYPES.join(',')} className="hidden" aria-label={t.upload} onChange={(e) => void onFile(e)} data-testid="avatar-input" />
        <Button loading={loading} onClick={() => inputRef.current?.click()}>
          {loading ? t.uploading : t.upload}
        </Button>
        {viewer.avatarUrl ? (
          <Button variant="subtle" loading={removing} onClick={() => void onRemove()}>
            {t.remove}
          </Button>
        ) : null}
      </SettingsRow>
    </SettingsSection>
  );
}

function DetailsSection() {
  const t = m.settingsAccount.profile;
  const { viewer } = useWorkspace();
  const [name, setName] = useState(viewer.name);
  const [username, setUsername] = useState(viewer.username);
  const [email, setEmail] = useState(viewer.email ?? '');
  const [touched, setTouched] = useState(false);
  const [update, { loading }] = useOptimisticMutation(UpdateProfileDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      updateProfile: {
        ...viewer,
        name: vars.input.name ?? viewer.name,
        username: vars.input.username ?? viewer.username,
        email: vars.input.email ?? viewer.email,
      },
    }),
    rollback: () => t.saveFailed,
  });

  const nameErr = name.trim() ? null : t.nameRequired;
  const userErr = USERNAME_RE.test(username) ? null : t.usernameInvalid;
  const emailErr = !email.trim() || EMAIL_RE.test(email.trim()) ? null : t.emailInvalid;
  const dirty = name.trim() !== viewer.name || username !== viewer.username || email.trim() !== (viewer.email ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameErr || userErr || emailErr || !dirty) return;
    await update({
      input: {
        name: name.trim(),
        username: username !== viewer.username ? username : undefined,
        email: email.trim() !== (viewer.email ?? '') ? email.trim() : undefined,
      },
    });
    setTouched(false);
  };

  return (
    <SettingsSection title={t.detailsTitle}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <SectionBody className="flex flex-col gap-4">
          <TextField label={t.name} value={name} onChange={(e) => setName(e.target.value)} error={touched ? nameErr : null} autoComplete="name" />
          <TextField
            label={t.username}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            helperText={t.usernameHelp}
            error={touched ? userErr : null}
            className="font-mono"
            autoComplete="username"
          />
          <TextField label={t.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} helperText={t.emailHelp} error={touched ? emailErr : null} autoComplete="email" />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={loading} disabled={!dirty}>
              {m.common.save}
            </Button>
          </div>
        </SectionBody>
      </form>
    </SettingsSection>
  );
}

function ThemeSection() {
  const t = m.settingsAccount.profile;
  const pref = useTheme((s) => s.pref);
  const setTheme = useSetTheme();
  return (
    <SettingsSection title={t.themeTitle}>
      <SettingsRow label={t.themeLabel} description={t.themeHelp}>
        <RadioGroup label={t.themeLabel} value={pref} onChange={(v) => setTheme(v as ThemePref)} orientation="horizontal" className="gap-4">
          <Radio value="dark" label={t.dark} />
          <Radio value="light" label={t.light} />
          <Radio value="system" label={t.system} />
        </RadioGroup>
      </SettingsRow>
    </SettingsSection>
  );
}

function PasswordSection() {
  const t = m.settingsAccount.profile;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [change, { loading }] = useOptimisticMutation(ChangePasswordDocument, {
    optimistic: { serverConfirmed: 'The server verifies the current password and revokes other sessions.' },
    rollback: () => t.passwordFailed,
    silent: true,
  });

  const currentErr = current ? null : t.currentRequired;
  const nextErr = next.length >= MIN_PASSWORD ? null : t.tooShort;
  const confirmErr = confirm === next ? null : t.mismatch;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setDone(false);
    setServerError(null);
    if (currentErr || nextErr || confirmErr) return;
    const { error } = await change({ currentPassword: current, newPassword: next });
    if (error) {
      setServerError(error.message);
      return;
    }
    setCurrent('');
    setNext('');
    setConfirm('');
    setTouched(false);
    setDone(true);
  };

  return (
    <SettingsSection title={t.passwordTitle} description={t.passwordHelp}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <SectionBody className="flex flex-col gap-4">
          {serverError ? <InlineMessage appearance="error">{serverError}</InlineMessage> : null}
          {done ? (
            <InlineMessage appearance="success" title={t.passwordChanged}>
              {t.passwordChangedHelp}
            </InlineMessage>
          ) : null}
          <TextField label={t.currentPassword} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} error={touched ? currentErr : null} autoComplete="current-password" />
          <TextField label={t.newPassword} type="password" value={next} onChange={(e) => setNext(e.target.value)} helperText={t.newPasswordHelp} error={touched ? nextErr : null} autoComplete="new-password" />
          <TextField label={t.confirmPassword} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={touched ? confirmErr : null} autoComplete="new-password" />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={loading}>
              {t.changePassword}
            </Button>
          </div>
        </SectionBody>
      </form>
    </SettingsSection>
  );
}

export function ProfileSettings() {
  return (
    <SettingsPage title={m.settings.sections.profile} testId="settings-profile">
      <AvatarSection />
      <DetailsSection />
      <ThemeSection />
      <PasswordSection />
    </SettingsPage>
  );
}

