/** Copy-paste setup snippets for the MCP settings screen. Pure, so they can be unit tested. */

export const MCP_KEY_PLACEHOLDER = 'vel_your_api_key';

export interface McpSnippetInput {
  serverUrl: string;
  /** `<server>/mcp`, or null when the operator disabled the HTTP transport. */
  httpEndpoint: string | null;
  /** Versioned tarball of the stdio client, or null when this build does not ship one. */
  clientPackageUrl: string | null;
}

export function claudeCodeCommand(httpEndpoint: string): string {
  return `claude mcp add --transport http velocity ${httpEndpoint} --header "X-Api-Key: ${MCP_KEY_PLACEHOLDER}"`;
}

export function claudeDesktopConfig(serverUrl: string, clientPackageUrl: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        velocity: {
          command: 'npx',
          args: ['-y', clientPackageUrl],
          env: { VELOCITY_URL: serverUrl, VELOCITY_API_KEY: MCP_KEY_PLACEHOLDER },
        },
      },
    },
    null,
    2,
  ).replace(/\[\s+("[^\]]*?)\s+\]/g, (_m, inner: string) => `[${inner.replace(/\s*\n\s*/g, ' ')}]`);
}

export function cursorConfig(httpEndpoint: string): string {
  return JSON.stringify({ mcpServers: { velocity: { url: httpEndpoint, headers: { 'X-Api-Key': MCP_KEY_PLACEHOLDER } } } }, null, 2);
}

export function npxCommand(clientPackageUrl: string): string {
  return `npx -y ${clientPackageUrl}`;
}
