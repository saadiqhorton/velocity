import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApolloClient, useQuery } from '@apollo/client';
import { Button, InlineMessage, Skeleton, TextField } from '@velocity/ui';
import { AcceptInviteDocument, InviteInfoDocument, SetupStatusDocument, ViewerDocument } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';
import { AuthLayout } from './AuthLayout';

/** Invite acceptance (SPEC §3.2.1): shared-secret link → create a member account. */
export function Invite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const client = useApolloClient();
  const info = useQuery(InviteInfoDocument, { variables: { token } });
  const [name, setName] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [accept, { loading }] = useOptimisticMutation(AcceptInviteDocument, {
    optimistic: { serverConfirmed: 'Account creation and the session cookie happen on the server.' },
    rollback: () => m.flags.rollback.generic,
    silent: true,
  });

  if (info.loading) {
    return (
      <AuthLayout title={m.auth.inviteTitle('')}>
        <Skeleton rows={4} />
      </AuthLayout>
    );
  }
  const data = info.data?.inviteInfo;
  if (!data?.valid) {
    return (
      <AuthLayout title={m.auth.inviteTitle(data?.workspaceName ?? '')}>
        <InlineMessage appearance="error">{m.auth.inviteInvalid}</InlineMessage>
      </AuthLayout>
    );
  }

  const submit = async () => {
    setError(null);
    if (password.length < 10) {
      setError(m.auth.passwordTooShort);
      return;
    }
    const res = await accept({ input: { token, username: username.trim(), password, name: (name ?? data.name ?? '').trim() || undefined, email: email.trim() || undefined } });
    if (res.error) {
      setError(res.error.message);
      return;
    }
    await client.refetchQueries({ include: [ViewerDocument, SetupStatusDocument] });
    navigate('/', { replace: true });
  };

  return (
    <AuthLayout title={m.auth.inviteTitle(data.workspaceName ?? '')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error ? <InlineMessage appearance="error">{error}</InlineMessage> : null}
        <TextField label={m.auth.displayName} autoFocus value={name ?? data.name ?? ''} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        <TextField label={m.auth.username} required value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        <TextField label={m.auth.email} helperText={m.auth.emailHelp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <TextField
          label={m.auth.password}
          helperText={m.auth.passwordHelp}
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <Button type="submit" variant="primary" fullWidth loading={loading} disabled={!username.trim() || !password}>
          {m.auth.acceptInvite}
        </Button>
      </form>
    </AuthLayout>
  );
}
