import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApolloClient, useQuery } from '@apollo/client';
import clsx from 'clsx';
import { Button, Icon, InlineMessage, TextField } from '@velocity/ui';
import {
  BootstrapDocument,
  CompleteSetupDocument,
  CreateTeamDocument,
  IntegrationsDocument,
  SetupStatusDocument,
  SetupWorkspaceDocument,
  ViewerDocument,
} from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';
import { AuthLayout } from './AuthLayout';

type Step = 'owner' | 'workspace' | 'team' | 'github' | 'done';
const STEPS: Step[] = ['owner', 'workspace', 'team', 'github', 'done'];
const TEAM_KEY_RE = /^[A-Z][A-Z0-9]{0,9}$/;

/** Derive a team key from a name: "Engineering" → "ENG", "Web app" → "WA". */
export function suggestTeamKey(name: string): string {
  const words = name.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const raw = words.length === 1 ? (words[0] ?? '').slice(0, 3) : words.map((w) => w[0]).join('').slice(0, 4);
  return /^[A-Z]/.test(raw) ? raw : `T${raw}`.slice(0, 10);
}

function Steps({ current }: { current: Step }) {
  const labels: Record<Step, string> = {
    owner: m.auth.setupStepOwner,
    workspace: m.auth.setupStepWorkspace,
    team: m.auth.setupStepTeam,
    github: m.auth.setupStepGithub,
    done: m.auth.setupStepDone,
  };
  const idx = STEPS.indexOf(current);
  return (
    <ol className="mb-6 flex items-start gap-2" aria-label={m.auth.stepOf(idx + 1, STEPS.length)}>
      {STEPS.map((s, i) => (
        <li key={s} className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={clsx('h-1 rounded-full', i <= idx ? 'bg-primary' : 'bg-neutral')} aria-hidden="true" />
          <span className={clsx('truncate text-xs', i === idx ? 'font-semibold text-fg' : 'text-fg-subtlest')} aria-current={i === idx ? 'step' : undefined}>
            {labels[s]}
          </span>
        </li>
      ))}
    </ol>
  );
}

function StepForm({ children, onSubmit }: { children: ReactNode; onSubmit: () => void }) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

/**
 * First-run wizard (SPEC §3.3): owner → workspace → first team (suggest ENG) → optional
 * GitHub → done. Target: under two minutes. Resumes at the team step after a reload.
 */
export function Setup() {
  const navigate = useNavigate();
  const client = useApolloClient();
  const status = useQuery(SetupStatusDocument);
  const viewer = useQuery(ViewerDocument);
  const signedIn = Boolean(viewer.data?.viewer);
  const [step, setStep] = useState<Step>(signedIn ? 'team' : 'owner');
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [teamName, setTeamName] = useState('Engineering');
  const [teamKey, setTeamKey] = useState('ENG');
  const [keyTouched, setKeyTouched] = useState(false);

  const integrations = useQuery(IntegrationsDocument, { skip: step !== 'github' });

  const [setup, setupState] = useOptimisticMutation(SetupWorkspaceDocument, {
    optimistic: { serverConfirmed: 'Creates the owner account and session; nothing to predict.' },
    rollback: () => m.flags.rollback.generic,
    silent: true,
  });
  const [createTeam, teamState] = useOptimisticMutation(CreateTeamDocument, {
    optimistic: { serverConfirmed: 'First-run step; the wizard waits for the server before continuing.' },
    rollback: () => m.flags.rollback.generic,
    silent: true,
  });
  const [complete, completeState] = useOptimisticMutation(CompleteSetupDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, completeSetup: true }),
    rollback: () => m.flags.rollback.generic,
  });

  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const ownerValid = username.trim().length > 0 && password.length >= 10 && password === confirm;

  const submitOwner = () => {
    if (password.length < 10) return setError(m.auth.passwordTooShort);
    if (password !== confirm) return setError(m.auth.passwordMismatch);
    go('workspace');
  };

  const submitWorkspace = async () => {
    const res = await setup({
      input: { workspaceName: workspaceName.trim(), username: username.trim(), password, name: name.trim() || undefined, email: email.trim() || undefined },
    });
    if (res.error) {
      setError(res.error.message);
      // A validation error on the owner fields sends the user back to fix them.
      if (/password|username|email/i.test(res.error.serverMessage ?? '')) setStep('owner');
      return;
    }
    // Viewer first: if setup status flipped while the viewer is still cached as signed out,
    // AuthGate would bounce the new owner to /login.
    await client.refetchQueries({ include: [ViewerDocument] });
    await client.refetchQueries({ include: [SetupStatusDocument] });
    go('team');
  };

  const submitTeam = async () => {
    const key = teamKey.trim().toUpperCase();
    if (!TEAM_KEY_RE.test(key)) return setError(m.auth.teamKeyInvalid);
    const res = await createTeam({ input: { name: teamName.trim(), key } });
    if (res.error) {
      // The team may already exist after a reload; continue if so.
      if (res.error.code !== 'CONFLICT') return setError(res.error.message);
    }
    go('github');
  };

  const finish = async () => {
    await complete({});
    await client.refetchQueries({ include: [SetupStatusDocument, BootstrapDocument] });
    navigate(`/team/${teamKey.trim().toUpperCase() || ''}/active`, { replace: true });
  };

  const titles: Record<Step, string> = {
    owner: m.auth.setupTitle,
    workspace: m.auth.setupTitle,
    team: m.auth.setupTitle,
    github: m.auth.setupTitle,
    done: m.auth.setupDoneTitle,
  };

  return (
    <AuthLayout title={titles[step]} wide>
      <div data-testid={`setup-step-${step}`}>
        <Steps current={step} />
        {error ? (
          <div className="mb-4">
            <InlineMessage appearance="error">{error}</InlineMessage>
          </div>
        ) : null}
        {step === 'owner' ? (
          <StepForm onSubmit={submitOwner}>
            {status.data?.setupStatus.needsSetup === false && !signedIn ? <InlineMessage appearance="info">{m.auth.alreadySetUp}</InlineMessage> : null}
            <TextField label={m.auth.displayName} autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
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
            <TextField
              label={m.auth.confirmPassword}
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              error={confirm && confirm !== password ? m.auth.passwordMismatch : undefined}
            />
            <Button type="submit" variant="primary" fullWidth disabled={!ownerValid}>
              {m.common.continue}
            </Button>
          </StepForm>
        ) : null}
        {step === 'workspace' ? (
          <StepForm onSubmit={() => void submitWorkspace()}>
            <TextField
              label={m.auth.workspaceName}
              helperText={m.auth.workspaceNameHelp}
              autoFocus
              required
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={() => go('owner')}>{m.common.back}</Button>
              <Button type="submit" variant="primary" fullWidth loading={setupState.loading} disabled={!workspaceName.trim()}>
                {m.common.continue}
              </Button>
            </div>
          </StepForm>
        ) : null}
        {step === 'team' ? (
          <StepForm onSubmit={() => void submitTeam()}>
            <TextField
              label={m.auth.teamName}
              autoFocus
              required
              value={teamName}
              onChange={(e) => {
                setTeamName(e.target.value);
                if (!keyTouched) setTeamKey(suggestTeamKey(e.target.value));
              }}
            />
            <TextField
              label={m.auth.teamKey}
              helperText={m.auth.teamKeyHelp}
              required
              value={teamKey}
              className="font-mono uppercase"
              maxLength={10}
              onChange={(e) => {
                setKeyTouched(true);
                setTeamKey(e.target.value.toUpperCase());
              }}
              error={teamKey && !TEAM_KEY_RE.test(teamKey) ? m.auth.teamKeyInvalid : undefined}
            />
            <Button type="submit" variant="primary" fullWidth loading={teamState.loading} disabled={!teamName.trim() || !TEAM_KEY_RE.test(teamKey)}>
              {m.common.continue}
            </Button>
          </StepForm>
        ) : null}
        {step === 'github' ? (
          <div className="flex flex-col gap-4">
            <p className="text-base text-fg-subtle">{m.auth.githubIntro}</p>
            {integrations.data?.githubIntegration.configured && integrations.data.githubIntegration.installUrl ? (
              <Button
                iconBefore={<Icon name="github" />}
                onClick={() => window.open(integrations.data?.githubIntegration.installUrl ?? '', '_blank', 'noopener')}
              >
                {m.auth.githubConnect}
              </Button>
            ) : integrations.data ? (
              <InlineMessage appearance="info">{m.auth.githubNotConfigured}</InlineMessage>
            ) : null}
            <div className="flex gap-2">
              <Button variant="primary" fullWidth onClick={() => go('done')} data-testid="setup-github-continue">
                {m.common.continue}
              </Button>
            </div>
          </div>
        ) : null}
        {step === 'done' ? (
          <div className="flex flex-col gap-4">
            <p className="text-base text-fg-subtle">{m.auth.setupDoneBody}</p>
            <Button variant="primary" fullWidth loading={completeState.loading} onClick={() => void finish()} autoFocus data-testid="setup-finish">
              {m.auth.openWorkspace}
            </Button>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  );
}
