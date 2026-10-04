import { useState } from 'react';
import { useQuery } from '@apollo/client';
import { Avatar, Banner, Button, DropdownMenu, EmptyState, Icon, IconButton, InlineMessage, Lozenge, MenuItem, Modal, Skeleton, Table, TextField, ConfirmDialog } from '@velocity/ui';
import type { TableColumn } from '@velocity/ui';
import {
  CreateInviteDocument,
  MembersDocument,
  RemoveMemberDocument,
  RevokeInviteDocument,
  SetMemberPasswordDocument,
  SetMemberSuspendedDocument,
} from '@/gql/graphql';
import type { MembersQuery } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { describeError } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { OwnerOnlyNotice, SettingsPage, SettingsSection, useIsOwner } from '../common';
import { m } from '@/i18n';

type Member = MembersQuery['users'][number];
type Invite = MembersQuery['invites'][number];

const MIN_PASSWORD = 10;

export function inviteLink(url: string | null | undefined): string {
  if (!url) return '';
  return url.startsWith('/') ? `${window.location.origin}${url}` : url;
}

export function MembersSettings() {
  const t = m.settingsWorkspace.members;
  const isOwner = useIsOwner();
  const { data, loading, error } = useQuery(MembersDocument);
  const [inviteOpen, setInviteOpen] = useState(false);
  const members = (data?.users ?? []).filter((u) => !u.removed);
  const invites = data?.invites ?? [];

  return (
    <SettingsPage
      title={m.settings.sections.members}
      description={t.description}
      wide
      testId="settings-members"
      actions={
        isOwner ? (
          <Button variant="primary" iconBefore={<Icon name="add" />} onClick={() => setInviteOpen(true)}>
            {t.invite}
          </Button>
        ) : undefined
      }
    >
      <OwnerOnlyNotice />
      {error ? (
        <Banner appearance="error">{describeError(error).message}</Banner>
      ) : loading && !data ? (
        <div className="flex flex-col gap-2" role="status" aria-label={m.common.loading}>
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      ) : (
        <>
          <MembersTable members={members} isOwner={isOwner} />
          {isOwner ? <PendingInvites invites={invites} /> : null}
        </>
      )}
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </SettingsPage>
  );
}

function MembersTable({ members, isOwner }: { members: Member[]; isOwner: boolean }) {
  const t = m.settingsWorkspace.members;
  const [passwordFor, setPasswordFor] = useState<Member | null>(null);
  const [removeFor, setRemoveFor] = useState<Member | null>(null);
  const [setSuspended] = useOptimisticMutation(SetMemberSuspendedDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      setMemberSuspended: { __typename: 'User' as const, id: vars.userId, suspended: vars.suspended },
    }),
    rollback: () => t.flag.suspend,
    refetchQueries: ['Bootstrap'],
  });
  const [removeMember, { loading: removing }] = useOptimisticMutation(RemoveMemberDocument, {
    optimistic: { serverConfirmed: 'Removal also reassigns references server-side; the list is refetched.' },
    rollback: () => t.flag.remove,
    refetchQueries: ['Members', 'Bootstrap'],
  });

  const columns: TableColumn<Member>[] = [
    {
      key: 'name',
      header: t.colName,
      sortable: true,
      sortValue: (u) => u.name.toLowerCase(),
      render: (u) => (
        <span className="flex items-center gap-2">
          <Avatar name={u.name} src={u.avatarUrl} size={24} />
          <span className="truncate font-medium text-fg">{u.name}</span>
          {u.isMe ? <span className="text-sm text-fg-subtlest">({m.common.you})</span> : null}
        </span>
      ),
    },
    { key: 'username', header: t.colUsername, render: (u) => <span className="font-mono text-sm text-fg-subtle">{u.username}</span> },
    {
      key: 'role',
      header: t.colRole,
      render: (u) => <Lozenge appearance={u.isOwner ? 'new' : 'default'}>{u.isOwner ? t.owner : t.member}</Lozenge>,
    },
    {
      key: 'status',
      header: t.colStatus,
      render: (u) => <Lozenge appearance={u.suspended ? 'removed' : 'success'}>{u.suspended ? t.suspended : t.active}</Lozenge>,
    },
  ];
  if (isOwner) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">{m.common.more}</span>,
      width: 48,
      align: 'right',
      render: (u) =>
        u.isMe ? null : (
          <DropdownMenu
            aria-label={t.actionsFor(u.name)}
            placement="bottom-end"
            trigger={<IconButton label={t.actionsFor(u.name)} size="sm" variant="subtle" icon={<Icon name="more" />} onClick={(e) => e.stopPropagation()} />}
          >
            <MenuItem icon={<Icon name={u.suspended ? 'check' : 'blocked'} />} onSelect={() => void setSuspended({ userId: u.id, suspended: !u.suspended })}>
              {u.suspended ? t.reactivate : t.suspend}
            </MenuItem>
            <MenuItem icon={<Icon name="key" />} onSelect={() => setPasswordFor(u)}>
              {t.setPassword}
            </MenuItem>
            <MenuItem icon={<Icon name="trash" />} danger onSelect={() => setRemoveFor(u)}>
              {t.remove}
            </MenuItem>
          </DropdownMenu>
        ),
    });
  }

  return (
    <div className="overflow-hidden rounded-md border border-border" data-testid="members-table">
      <Table
        aria-label={t.tableLabel}
        columns={columns}
        rows={members}
        rowKey={(u) => u.id}
        defaultSort={{ key: 'name', direction: 'asc' }}
        emptyState={<EmptyState icon="users" message={t.empty} />}
      />
      <PasswordModal member={passwordFor} onClose={() => setPasswordFor(null)} />
      <ConfirmDialog
        open={removeFor !== null}
        onClose={() => setRemoveFor(null)}
        title={removeFor ? t.removeTitle(removeFor.name) : ''}
        description={t.removeBody}
        confirmLabel={t.removeConfirm}
        loading={removing}
        onConfirm={() => {
          if (!removeFor) return;
          void removeMember({ userId: removeFor.id }).then((r) => {
            if (r.data) setRemoveFor(null);
          });
        }}
      />
    </div>
  );
}

function PasswordModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  return member ? <PasswordModalInner key={member.id} member={member} onClose={onClose} /> : null;
}

function PasswordModalInner({ member, onClose }: { member: Member; onClose: () => void }) {
  const t = m.settingsWorkspace.members;
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [setMemberPassword, { loading }] = useOptimisticMutation(SetMemberPasswordDocument, {
    optimistic: { serverConfirmed: 'Passwords are write-only; there is nothing to predict.' },
    rollback: () => t.flag.password,
  });
  const tooShort = password.length < MIN_PASSWORD;
  const submit = async () => {
    setTouched(true);
    if (tooShort) return;
    const res = await setMemberPassword({ userId: member.id, password });
    if (res.data) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t.passwordTitle(member.name)}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{m.common.cancel}</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>
            {t.passwordSave}
          </Button>
        </>
      }
    >
      <TextField
        label={t.passwordLabel}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        helperText={t.passwordHelp}
        error={touched && tooShort ? t.passwordTooShort : undefined}
        data-autofocus
      />
    </Modal>
  );
}

function PendingInvites({ invites }: { invites: Invite[] }) {
  const t = m.settingsWorkspace.members;
  const [revoke] = useOptimisticMutation(RevokeInviteDocument, {
    optimistic: { serverConfirmed: 'Revocation is confirmed by the server; the list is refetched.' },
    rollback: () => t.flag.revoke,
    refetchQueries: ['Members'],
  });
  return (
    <SettingsSection title={t.pendingTitle} description={t.pendingDescription} testId="pending-invites">
      {invites.length === 0 ? (
        <p className="px-4 py-3 text-base text-fg-subtle">{t.noPending}</p>
      ) : (
        <ul>
          {invites.map((inv) => (
            <li key={inv.id} className="flex h-10 items-center gap-3 border-t border-border px-4 first:border-t-0">
              <Icon name="link" className="text-fg-subtlest" />
              <span className="min-w-0 flex-1 truncate text-base text-fg">{inv.name ?? t.pendingUnnamed}</span>
              <span className="text-sm text-fg-subtle">{t.pendingExpires(formatDate(inv.expiresAt))}</span>
              <Button size="sm" variant="subtle" aria-label={t.revokeInvite(inv.name ?? t.pendingUnnamed)} onClick={() => void revoke({ id: inv.id })}>
                {t.revoke}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <InviteModalInner onClose={onClose} /> : null;
}

function InviteModalInner({ onClose }: { onClose: () => void }) {
  const t = m.settingsWorkspace.members;
  const [name, setName] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [create, { loading }] = useOptimisticMutation(CreateInviteDocument, {
    optimistic: { serverConfirmed: 'The invite token is minted by the server and shown once.' },
    rollback: () => t.flag.invite,
    refetchQueries: ['Members'],
  });

  const submit = async () => {
    const res = await create({ name: name.trim() || null });
    if (res.data) setLink(inviteLink(res.data.createInvite.url));
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (link !== null) {
    return (
      <Modal
        open
        onClose={onClose}
        size="md"
        title={t.inviteReadyTitle}
        description={t.inviteReadyBody}
        footer={
          <>
            <Button onClick={onClose}>{m.common.done}</Button>
            <Button variant="primary" iconBefore={<Icon name={copied ? 'check' : 'copy'} />} onClick={() => void copy()}>
              {copied ? m.common.copied : m.common.copyLink}
            </Button>
          </>
        }
      >
        <TextField label={t.inviteLinkLabel} readOnly value={link} className="font-mono" onFocus={(e) => e.target.select()} data-autofocus />
        <InlineMessage appearance="info" className="mt-3">
          {t.inviteDescription}
        </InlineMessage>
      </Modal>
    );
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t.inviteTitle}
      description={t.inviteDescription}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{m.common.cancel}</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>
            {t.inviteCreate}
          </Button>
        </>
      }
    >
      <TextField label={t.inviteName} helperText={t.inviteNameHelp} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-autofocus />
    </Modal>
  );
}
