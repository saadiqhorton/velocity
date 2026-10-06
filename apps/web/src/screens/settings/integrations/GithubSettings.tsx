import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApolloClient, useQuery } from '@apollo/client';
import { Button, ConfirmDialog, EmptyState, Icon, InlineMessage, Lozenge, ProgressBar, Select, Skeleton, Spinner, Switch, TextField } from '@velocity/ui';
import {
  BeginGithubAppSetupDocument,
  ConfirmGithubAppSetupDocument,
  GithubCancelBackfillDocument,
  GithubCompleteInstallDocument,
  GithubStartBackfillDocument,
  IntegrationsDocument,
  RemoveGithubAppDocument,
  UninstallGithubDocument,
  UpdateGithubSettingsDocument,
} from '@/gql/graphql';
import type { IntegrationsQuery } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { describeError } from '@/lib/errors';
import { useOptimisticMutation } from '@/lib/mutation';
import { formatDate } from '@/lib/format';
import { m } from '@/i18n';
import { OwnerOnlyNotice, SettingsPage, SettingsRow, SettingsSection, useIsOwner } from '../common';

type Install = IntegrationsQuery['githubIntegration']['installs'][number];

/** Environment variables an advanced self-hoster can use instead (docs/self-hosting.md). */
const ENV_VARS = ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_CLIENT_SECRET', 'GITHUB_WEBHOOK_SECRET'] as const;

/**
 * One-click GitHub setup. Builds the App manifest on the server, then submits GitHub's registration
 * form as a top-level POST (a normal form, so the strict CSP `form-action` allows it). GitHub creates
 * the App and redirects back to /settings/github with a code we exchange server-side.
 */
function SetupGithubApp() {
  const t = m.settingsIntegrations.github;
  const [organization, setOrganization] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const [manifest, setManifest] = useState<{ action: string; manifest: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [begin, { loading }] = useOptimisticMutation(BeginGithubAppSetupDocument, {
    optimistic: { serverConfirmed: 'GitHub registers the App; the server cannot predict its id and secrets.' },
    rollback: () => t.setUpFailed,
    silent: true,
  });

  useEffect(() => {
    if (manifest) form.current?.submit();
  }, [manifest]);

  const start = () => {
    setError(null);
    void begin({ organization: organization.trim() || undefined }).then(({ data, error: err }) => {
      if (err || !data) {
        setError(t.setUpFailed);
        return;
      }
      setManifest(data.beginGithubAppSetup);
    });
  };

  return (
    <div className="rounded-md border border-border bg-surface p-4" data-testid="github-setup">
      <div className="flex items-start gap-3">
        <Icon name="github" className="mt-0.5 shrink-0 text-fg-subtle" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-fg">{t.notConfiguredTitle}</p>
          <p className="mt-0.5 text-sm text-fg-subtle">{t.notConfiguredBody}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="w-full sm:max-w-64">
              <TextField
                label={t.setUpOrgLabel}
                placeholder={t.setUpOrgPlaceholder}
                helperText={t.setUpOrgHelp}
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                data-testid="github-setup-org"
              />
            </div>
            <Button variant="primary" loading={loading} onClick={start} data-testid="github-setup-button">
              {loading ? t.setUpSubmitting : t.setUp}
            </Button>
          </div>
          {error ? (
            <InlineMessage appearance="error" onDismiss={() => setError(null)}>
              {error}
            </InlineMessage>
          ) : null}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-fg-subtle">{t.envFallbackTitle}</summary>
            <p className="mt-1 text-sm text-fg-subtle">{t.envFallbackBody}</p>
            <ul className="mt-2 flex flex-col gap-0.5" data-testid="github-env">
              {ENV_VARS.map((v) => (
                <li key={v}>
                  <code className="font-mono text-sm">{v}</code>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-sm text-fg-subtle">{t.envFallbackDocs}</p>
          </details>
        </div>
      </div>
      {/* Top-level form POST to github.com/settings/apps/new (SPEC §6.5.4 manifest flow). */}
      <form ref={form} method="post" action={manifest?.action ?? ''} className="hidden" data-testid="github-manifest-form">
        <input type="hidden" name="manifest" value={manifest?.manifest ?? ''} readOnly />
      </form>
    </div>
  );
}

function repoTeamMapOf(install: Install): Record<string, string> {
  const raw = install.repoTeamMap;
  return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
}

function BackfillStatus({ status }: { status: string }) {
  const t = m.settingsIntegrations.github.backfillStatus;
  const color = status === 'done' ? 'green' : status === 'running' ? 'blue' : status === 'failed' ? 'red' : status === 'canceled' ? 'yellow' : 'grey';
  const label = status in t ? t[status as keyof typeof t] : status;
  return <Lozenge color={color}>{label}</Lozenge>;
}

function InstallSection({ install, canEdit }: { install: Install; canEdit: boolean }) {
  const t = m.settingsIntegrations.github;
  const { teams } = useWorkspace();
  const client = useApolloClient();
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const running = install.backfillStatus === 'running';
  const map = repoTeamMapOf(install);

  const [update] = useOptimisticMutation(UpdateGithubSettingsDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation',
      updateGithubSettings: {
        ...install,
        autoCloseOnMerge: vars.input.autoCloseOnMerge ?? install.autoCloseOnMerge,
        issueSync: vars.input.issueSync ?? install.issueSync,
        issueSyncTeamId: vars.input.issueSyncTeamId === undefined ? install.issueSyncTeamId : vars.input.issueSyncTeamId,
        repoTeamMap: vars.input.repoTeamMap ?? install.repoTeamMap,
      },
    }),
    rollback: () => t.flags.updateFailed,
  });
  const [startBackfill, startState] = useOptimisticMutation(GithubStartBackfillDocument, {
    optimistic: { serverConfirmed: 'The server starts the job and reports progress; the client cannot predict it.' },
    rollback: () => t.flags.backfillFailed,
    refetchQueries: [IntegrationsDocument],
  });
  const [cancelBackfill, cancelState] = useOptimisticMutation(GithubCancelBackfillDocument, {
    optimistic: { serverConfirmed: 'Cancellation is acknowledged by the running job.' },
    rollback: () => t.flags.cancelFailed,
    refetchQueries: [IntegrationsDocument],
  });
  const [uninstall, uninstallState] = useOptimisticMutation(UninstallGithubDocument, {
    optimistic: () => ({ __typename: 'Mutation', uninstallGithub: true }),
    rollback: () => t.flags.uninstallFailed,
    update: (cache, _res, vars) => {
      cache.evict({ id: client.cache.identify({ __typename: 'GithubInstall', id: vars.installId }) });
      cache.gc();
    },
  });

  const teamOptions = [{ value: '', label: t.noTeam }, ...teams.map((tm) => ({ value: tm.id, label: `${tm.name} (${tm.key})` }))];

  return (
    <SettingsSection
      testId={`github-install-${install.accountLogin}`}
      title={install.accountLogin}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>{install.accountType}</span>
          <span className="identifier">#{install.installationId}</span>
          <span>{t.installedOn(formatDate(install.createdAt))}</span>
          {install.suspendedAt ? <Lozenge appearance="moved">{t.suspended}</Lozenge> : null}
        </span>
      }
      actions={
        canEdit ? (
          <Button variant="default" size="sm" onClick={() => setConfirmUninstall(true)}>
            {t.uninstall}
          </Button>
        ) : null
      }
    >
      <SettingsRow label={t.autoClose} description={t.autoCloseHelp}>
        <Switch
          aria-label={t.autoClose}
          checked={install.autoCloseOnMerge}
          disabled={!canEdit}
          onChange={(v) => void update({ installId: install.id, input: { autoCloseOnMerge: v } })}
        />
      </SettingsRow>
      <SettingsRow label={t.issueSync} description={t.issueSyncHelp}>
        <Switch
          aria-label={t.issueSync}
          checked={install.issueSync}
          disabled={!canEdit}
          onChange={(v) => void update({ installId: install.id, input: { issueSync: v } })}
        />
      </SettingsRow>
      <SettingsRow label={t.defaultTeam} description={t.defaultTeamHelp} htmlFor={`gh-default-${install.id}`}>
        <Select
          id={`gh-default-${install.id}`}
          size="sm"
          className="w-56"
          options={teamOptions}
          value={install.issueSyncTeamId ?? ''}
          disabled={!canEdit}
          onChange={(e) => void update({ installId: install.id, input: { issueSyncTeamId: e.target.value || null } })}
        />
      </SettingsRow>

      <div className="border-t border-border">
        <div className="flex h-10 items-center px-4 text-sm font-medium text-fg-subtle">{t.repos(install.repos.length)}</div>
        {install.repos.length === 0 ? (
          <p className="px-4 pb-3 text-sm text-fg-subtle">{t.noRepos}</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border" data-testid="github-repos">
            {install.repos.map((repo) => (
              <li key={repo} className="flex min-h-10 items-center gap-4 px-4 py-1">
                <code className="min-w-0 flex-1 truncate font-mono text-sm text-fg">{repo}</code>
                <label className="text-sm text-fg-subtle" htmlFor={`gh-repo-${install.id}-${repo}`}>
                  {t.createsIssuesIn}
                </label>
                <Select
                  id={`gh-repo-${install.id}-${repo}`}
                  size="sm"
                  className="w-56"
                  options={teamOptions.map((o) => (o.value === '' ? { ...o, label: t.defaultTeamOption } : o))}
                  value={map[repo] ?? ''}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const next = { ...map };
                    if (e.target.value) next[repo] = e.target.value;
                    else delete next[repo];
                    void update({ installId: install.id, input: { repoTeamMap: next } });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3" data-testid="github-backfill">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-base font-medium text-fg">
              {t.backfill}
              <BackfillStatus status={install.backfillStatus} />
            </div>
            <div className="mt-0.5 text-sm text-fg-subtle">{t.backfillHelp}</div>
          </div>
          {canEdit ? (
            running ? (
              <Button size="sm" loading={cancelState.loading} onClick={() => void cancelBackfill({ installId: install.id })}>
                {t.cancelBackfill}
              </Button>
            ) : (
              <Button size="sm" loading={startState.loading} onClick={() => void startBackfill({ installId: install.id })}>
                {install.backfillStatus === 'idle' ? t.startBackfill : t.rerunBackfill}
              </Button>
            )
          ) : null}
        </div>
        {running ? <ProgressBar value={install.backfillProgress * 100} label={t.backfillProgress} showPercent /> : null}
      </div>

      <ConfirmDialog
        open={confirmUninstall}
        onClose={() => setConfirmUninstall(false)}
        title={t.uninstallTitle(install.accountLogin)}
        description={t.uninstallBody}
        confirmLabel={t.uninstall}
        loading={uninstallState.loading}
        onConfirm={() => {
          void uninstall({ installId: install.id }).then(() => setConfirmUninstall(false));
        }}
      />
    </SettingsSection>
  );
}

export function GithubSettings() {
  const t = m.settingsIntegrations.github;
  const isOwner = useIsOwner();
  const [params, setParams] = useSearchParams();
  const installationParam = params.get('installation_id');
  const appCode = params.get('code');
  const appState = params.get('state');
  const { data, loading, error, refetch, startPolling, stopPolling } = useQuery(IntegrationsDocument);
  const installs = data?.githubIntegration.installs ?? [];
  const anyRunning = installs.some((i) => i.backfillStatus === 'running');
  // Backfill progress is server-driven: poll every 2s while any install is running (SPEC §4.9.11).
  useEffect(() => {
    if (anyRunning) startPolling(2000);
    else stopPolling();
    return () => stopPolling();
  }, [anyRunning, startPolling, stopPolling]);

  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [showRemove, setShowRemove] = useState(false);
  const handled = useRef<string | null>(null);
  const [complete] = useOptimisticMutation(GithubCompleteInstallDocument, {
    optimistic: { serverConfirmed: 'The installation is verified with GitHub on the server.' },
    rollback: () => t.flags.installFailed,
    silent: true,
    refetchQueries: [IntegrationsDocument],
  });
  const [confirmApp] = useOptimisticMutation(ConfirmGithubAppSetupDocument, {
    optimistic: { serverConfirmed: 'The server exchanges the code with GitHub and stores the App credentials.' },
    rollback: () => t.confirmFailed,
    silent: true,
    refetchQueries: [IntegrationsDocument],
  });
  const [removeApp, removeState] = useOptimisticMutation(RemoveGithubAppDocument, {
    optimistic: { serverConfirmed: 'The server deletes the stored App credentials.' },
    rollback: () => t.removeAppFailed,
    refetchQueries: [IntegrationsDocument],
  });

  // GitHub redirected back from the App-manifest form with a one-hour code.
  // Depend on the primitive params; `handled` makes StrictMode/re-render re-runs a no-op.
  useEffect(() => {
    if (!appCode || !appState || handled.current === `app:${appCode}`) return;
    handled.current = `app:${appCode}`;
    setCompleting(true);
    void confirmApp({ input: { code: appCode, state: appState } }).then(({ error: err }) => {
      setCompleting(false);
      setCompleteError(err ? t.confirmFailed : null);
      setParams({}, { replace: true });
    });
  }, [appCode, appState, confirmApp, setParams, t]);

  const installationId = installationParam === null ? null : Number(installationParam);
  const invalidParam = installationId !== null && !(Number.isInteger(installationId) && installationId > 0);

  useEffect(() => {
    if (installationId === null || invalidParam || handled.current === installationParam) return;
    handled.current = installationParam;
    setCompleting(true);
    void complete({ installationId }).then(({ error: err }) => {
      setCompleting(false);
      setCompleteError(err ? err.message : null);
      setParams({}, { replace: true });
    });
  }, [installationId, invalidParam, installationParam, complete, setParams]);

  const configured = data?.githubIntegration.configured ?? false;
  const source = data?.githubIntegration.source ?? null;
  const appName = data?.githubIntegration.appName ?? null;
  const installUrl = data?.githubIntegration.installUrl ?? null;
  const install = () => {
    if (installUrl) window.location.assign(installUrl);
  };

  return (
    <SettingsPage
      title={m.settings.sections.github}
      description={t.description}
      testId="settings-github"
      actions={
        configured && installUrl && isOwner && installs.length > 0 ? (
          <Button variant="default" iconBefore={<Icon name="add" />} onClick={install}>
            {t.addAccount}
          </Button>
        ) : null
      }
    >
      <OwnerOnlyNotice />
      {completing ? (
        <InlineMessage appearance="info">
          <span className="inline-flex items-center gap-2">
            <Spinner size={16} label="" /> {t.completing}
          </span>
        </InlineMessage>
      ) : null}
      {completeError || invalidParam ? (
        <InlineMessage
          appearance="error"
          title={t.confirmFailedTitle}
          onDismiss={() => {
            setCompleteError(null);
            setParams({}, { replace: true });
          }}
        >
          {completeError ?? t.badInstallation}
        </InlineMessage>
      ) : null}
      {loading && !data ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : error || !data ? (
        <InlineMessage appearance="error" action={<Button size="sm" onClick={() => void refetch()}>{m.common.retry}</Button>}>
          {describeError(error).message}
        </InlineMessage>
      ) : !configured ? (
        <SetupGithubApp />
      ) : installs.length === 0 ? (
        <div className="rounded-md border border-border">
          <EmptyState
            icon="github"
            message={t.noInstalls}
            action={
              installUrl ? (
                <Button variant="primary" onClick={install} disabled={!isOwner}>
                  {t.install}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        installs.map((i) => <InstallSection key={i.id} install={i} canEdit={isOwner} />)
      )}
      {configured && !installUrl && !loading ? <InlineMessage appearance="warning">{t.noInstallUrl}</InlineMessage> : null}
      {configured && isOwner ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-sm text-fg-subtle">
            {source === 'database' ? (
              <>
                {t.configuredSourceDb}
                {appName ? ` ${t.appNameLabel(appName)}` : ''}
              </>
            ) : (
              t.configuredSourceEnv
            )}
          </p>
          {source === 'database' ? (
            <Button variant="default" size="sm" onClick={() => setShowRemove(true)} data-testid="github-remove-app">
              {t.removeApp}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={showRemove}
        onClose={() => setShowRemove(false)}
        title={t.removeAppTitle}
        description={t.removeAppBody}
        confirmLabel={t.removeApp}
        loading={removeState.loading}
        onConfirm={() => {
          void removeApp({}).then(() => setShowRemove(false));
        }}
      />
    </SettingsPage>
  );
}
