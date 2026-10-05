import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { setupOwner, testConfig } from '../../../packages/services/test/helpers/harness';
import { boot } from './helpers';
import type { RunningApp } from './helpers';

let running: RunningApp | undefined;
afterEach(async () => { await running?.close(); running = undefined; });

async function exerciseWorkflow(client: Client, prefix: string): Promise<void> {
  const teams = await client.callTool({ name: 'list_teams', arguments: {} });
  expect(teams.isError).not.toBe(true);
  const listed = teams.structuredContent as { teams: { key: string; statuses: { name: string; category: string }[] }[] };
  const team = listed.teams.find((t) => t.key === 'MCP');
  expect(team).toBeDefined();
  const done = team!.statuses.find((status) => status.category === 'done');
  expect(done).toBeDefined();

  const created = await client.callTool({ name: 'create_issue', arguments: { team_key: team!.key, title: `${prefix} transport smoke` } });
  expect(created.isError).not.toBe(true);
  const identifier = ((created.structuredContent as { issue: { identifier: string } }).issue).identifier;
  expect(identifier).toMatch(/^MCP-\d+$/);

  const commented = await client.callTool({ name: 'add_comment', arguments: { identifier, body_md: `Comment from ${prefix}` } });
  expect(commented.isError).not.toBe(true);
  const closed = await client.callTool({ name: 'set_status', arguments: { identifier, status_name: done!.name } });
  expect(closed.isError).not.toBe(true);

  const fetched = await client.callTool({ name: 'get_issue', arguments: { identifier } });
  expect(fetched.isError).not.toBe(true);
  const issue = (fetched.structuredContent as { issue: { statusCategory: string; comments: { bodyMd: string }[] } }).issue;
  expect(issue.statusCategory).toBe('done');
  expect(issue.comments).toEqual(expect.arrayContaining([expect.objectContaining({ bodyMd: `Comment from ${prefix}` })]));
}

it('creates, comments and closes through the stdio and HTTP MCP client transports', async () => {
  const token = 'mcp-real-client-test-token-1234567890';
  const app = testConfig({ mcp: { httpEnabled: true, httpToken: token } });
  running = await boot({ app });
  const owner = await setupOwner(running.h);
  await running.app.services.teams.create(owner, { key: 'MCP', name: 'MCP smoke' });
  const key = await running.app.services.apiKeys.create(owner, { name: 'mcp-real-client', scope: 'write' });

  const entry = fileURLToPath(new URL('../../mcp/src/index.ts', import.meta.url));
  const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  const stdioTransport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', entry],
    cwd: fileURLToPath(new URL('../../mcp/', import.meta.url)),
    env: { ...env, VELOCITY_URL: running.base, VELOCITY_API_KEY: key.plaintext },
    stderr: 'pipe',
  });
  const stdioClient = new Client({ name: 'mcp-stdio-smoke', version: '1' });
  try {
    await stdioClient.connect(stdioTransport);
    await exerciseWorkflow(stdioClient, 'stdio');
  } finally {
    await stdioClient.close();
  }

  const httpTransport = new StreamableHTTPClientTransport(new URL(`${running.base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}`, 'x-api-key': key.plaintext } },
  });
  const httpClient = new Client({ name: 'mcp-http-smoke', version: '1' });
  try {
    await httpClient.connect(httpTransport);
    await exerciseWorkflow(httpClient, 'HTTP');
    await httpTransport.terminateSession();
  } finally {
    await httpClient.close();
  }
}, 60_000);
