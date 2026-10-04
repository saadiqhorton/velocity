import { Link } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Button, InlineMessage, Skeleton } from '@velocity/ui';
import { IntegrationsDocument } from '@/gql/graphql';
import { describeError } from '@/lib/errors';
import { m } from '@/i18n';
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

export function clientConfig(stdioCommand: string, serverUrl: string): string {
  const [command = 'npx', ...args] = stdioCommand.trim().split(/\s+/);
  const json = JSON.stringify(
    { mcpServers: { velocity: { command, args, env: { VELOCITY_URL: serverUrl, VELOCITY_API_KEY: 'vel_your_api_key' } } } },
    null,
    2,
  );
  // Keep the args array on one line, the way client docs print it.
  return json.replace(/\[\s+("[^\]]*?)\s+\]/g, (_m, inner: string) => `[${inner.replace(/\s*\n\s*/g, ' ')}]`);
}

export function McpSettings() {
  const t = m.settingsIntegrations.mcp;
  const { data, loading, error, refetch } = useQuery(IntegrationsDocument);
  const info = data?.mcpInfo;
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
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-fg">{t.stdio}</span>
                <CopyField value={info.stdioCommand} what={t.stdio} testId="mcp-stdio" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-fg">{t.http}</span>
                {info.httpEnabled && info.httpEndpoint ? (
                  <>
                    <CopyField value={info.httpEndpoint} what={t.http} testId="mcp-http" />
                    <p className="text-sm text-fg-subtle">{t.httpAuth}</p>
                  </>
                ) : (
                  <p className="text-sm text-fg-subtle">{t.httpDisabled}</p>
                )}
              </div>
            </SectionBody>
          </SettingsSection>

          <SettingsSection title={t.clientConfig} description={t.clientConfigHelp}>
            <SectionBody className="flex flex-col gap-3">
              <CodeBlock code={clientConfig(info.stdioCommand, info.serverUrl)} what={t.clientConfig} label={t.clientConfig} testId="mcp-config" />
              <InlineMessage appearance="info">
                {t.apiKeyHint}{' '}
                <Link to="/settings/api-keys" className="text-link underline">
                  {t.apiKeyLink}
                </Link>
              </InlineMessage>
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
