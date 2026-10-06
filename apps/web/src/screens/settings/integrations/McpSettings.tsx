import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Button, InlineMessage, Skeleton, Tabs } from '@velocity/ui';
import { IntegrationsDocument } from '@/gql/graphql';
import { describeError } from '@/lib/errors';
import { m } from '@/i18n';
import { claudeCodeCommand, claudeDesktopConfig, codexConfig, cursorConfig, npxCommand, vscodeConfig } from '@/lib/mcpSnippets';
import { SectionBody, SettingsPage, SettingsSection } from '../common';
import { CodeBlock, CopyField } from './shared';

/** Tool names are the MCP contract (SPEC §6.6.1); descriptions come from the message catalog. */
const TOOL_NAMES = [
  'create_issue',
  'update_issue',
  'get_issue',
  'search_issues',
  'list_issues',
  'add_comment',
  'manage_labels',
  'set_status',
  'assign_issue',
  'list_teams',
  'list_cycles',
  'get_project',
  'list_projects',
] as const;

export function McpSettings() {
  const t = m.settingsIntegrations.mcp;
  const { data, loading, error, refetch } = useQuery(IntegrationsDocument);
  const info = data?.mcpInfo;
  const endpoint = info?.httpEnabled ? (info.httpEndpoint ?? null) : null;
  const pkg = info?.clientPackageUrl ?? null;
  const httpPanel = (help: string, block: ReactNode) =>
    endpoint ? (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-subtle">{help}</p>
        {block}
      </div>
    ) : (
      <p className="text-sm text-fg-subtle">{t.httpDisabled}</p>
    );
  return (
    <SettingsPage title={m.settings.sections.mcp} description={t.description} testId="settings-mcp">
      {loading && !info ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : error || !info ? (
        <InlineMessage appearance="error" action={<Button size="sm" onClick={() => void refetch()}>{m.common.retry}</Button>}>
          {describeError(error).message}
        </InlineMessage>
      ) : (
        <>
          <SettingsSection title={t.connect} description={t.connectHelp}>
            <SectionBody className="flex flex-col gap-4">
              <InlineMessage appearance="info">
                {t.apiKeyHint}{' '}
                <Link to="/settings/api-keys" className="text-link underline">
                  {t.apiKeyLink}
                </Link>
              </InlineMessage>
              <Tabs
                aria-label={t.connect}
                items={[
                  {
                    id: 'claude-code',
                    label: t.tabs.claudeCode,
                    panel: httpPanel(t.claudeCodeHelp, endpoint && <CodeBlock code={claudeCodeCommand(endpoint)} what={t.tabs.claudeCode} label={t.tabs.claudeCode} testId="mcp-claude-code" />),
                  },
                  {
                    id: 'claude-desktop',
                    label: t.tabs.claudeDesktop,
                    panel: pkg ? (
                      <div className="flex flex-col gap-3">
                        <p className="text-sm text-fg-subtle">{t.claudeDesktopHelp}</p>
                        <CodeBlock code={claudeDesktopConfig(info.serverUrl, pkg)} what={t.tabs.claudeDesktop} label={t.tabs.claudeDesktop} testId="mcp-claude-desktop" />
                      </div>
                    ) : (
                      <p className="text-sm text-fg-subtle">{t.clientUnavailable}</p>
                    ),
                  },
                  {
                    id: 'codex',
                    label: t.tabs.codex,
                    panel: httpPanel(t.codexHelp, endpoint && <CodeBlock code={codexConfig(endpoint)} what={t.tabs.codex} label={t.tabs.codex} testId="mcp-codex" />),
                  },
                  {
                    id: 'cursor',
                    label: t.tabs.cursor,
                    panel: httpPanel(t.cursorHelp, endpoint && <CodeBlock code={cursorConfig(endpoint)} what={t.tabs.cursor} label={t.tabs.cursor} testId="mcp-cursor" />),
                  },
                  {
                    id: 'vscode',
                    label: t.tabs.vscode,
                    panel: httpPanel(t.vscodeHelp, endpoint && <CodeBlock code={vscodeConfig(endpoint)} what={t.tabs.vscode} label={t.tabs.vscode} testId="mcp-vscode" />),
                  },
                  {
                    id: 'other',
                    label: t.tabs.other,
                    panel: (
                      <div className="flex flex-col gap-4">
                        {endpoint ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-fg">{t.http}</span>
                            <CopyField value={endpoint} what={t.http} testId="mcp-http" />
                            <p className="text-sm text-fg-subtle">{t.httpAuth}</p>
                          </div>
                        ) : (
                          <p className="text-sm text-fg-subtle">{t.httpDisabled}</p>
                        )}
                        {pkg ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-fg">{t.stdio}</span>
                            <CopyField value={npxCommand(pkg)} what={t.stdio} testId="mcp-stdio" />
                            <p className="text-sm text-fg-subtle">{t.stdioHelp}</p>
                          </div>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            </SectionBody>
          </SettingsSection>

          <SettingsSection title={t.tools} description={t.toolsHelp(TOOL_NAMES.length)}>
            <ul className="divide-y divide-border" data-testid="mcp-tools">
              {TOOL_NAMES.map((name) => (
                <li key={name} className="flex min-h-10 items-center gap-4 px-4 py-2">
                  <code className="w-40 shrink-0 font-mono text-sm text-fg">{name}</code>
                  <span className="min-w-0 text-sm text-fg-subtle">{t.toolDescriptions[name]}</span>
                </li>
              ))}
            </ul>
          </SettingsSection>
        </>
      )}
    </SettingsPage>
  );
}
