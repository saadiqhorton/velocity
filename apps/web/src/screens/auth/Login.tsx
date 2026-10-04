import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApolloClient } from '@apollo/client';
import { Button, Checkbox, InlineMessage, TextField } from '@velocity/ui';
import { LoginDocument, SetupStatusDocument, ViewerDocument } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';
import { AuthLayout } from './AuthLayout';

export function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const client = useApolloClient();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(params.get('expired') ? m.auth.sessionExpired : null);
  const [run, { loading }] = useOptimisticMutation(LoginDocument, {
    optimistic: { serverConfirmed: 'Credentials are verified by the server; the session cookie comes back with the response.' },
    rollback: () => m.auth.badCredentials,
    silent: true,
  });

  const submit = async () => {
    setError(null);
    const res = await run({ input: { login: login.trim(), password, remember } });
    if (res.error) {
      setError(res.error.code === 'UNAUTHENTICATED' || res.error.code === 'VALIDATION' || res.error.code === 'NOT_FOUND' ? m.auth.badCredentials : res.error.message);
      return;
    }
    await client.refetchQueries({ include: [ViewerDocument, SetupStatusDocument] });
    const next = params.get('next');
    navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
  };

  return (
    <AuthLayout title={m.auth.loginTitle}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error ? <InlineMessage appearance="error">{error}</InlineMessage> : null}
        <TextField
          label={m.auth.loginField}
          name="login"
          autoComplete="username"
          autoFocus
          required
          value={login}
          onChange={(e) => setLogin(e.target.value)}
        />
        <TextField
          label={m.auth.password}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Checkbox label={m.auth.remember} checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <Button type="submit" variant="primary" loading={loading} fullWidth disabled={!login.trim() || !password}>
          {m.auth.login}
        </Button>
      </form>
    </AuthLayout>
  );
}
