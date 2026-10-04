import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PASSWORD, setupOwner, testConfig } from '../../../packages/services/test/helpers/harness';
import { boot } from './helpers';
import type { RunningApp } from './helpers';

let running: RunningApp | undefined;
afterEach(async () => { await running?.close(); running = undefined; });

function connect(base: string, headers: Record<string, string>, params = {}): Promise<number | WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(base.replace('http:', 'ws:') + '/graphql', 'graphql-transport-ws', { headers });
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket handshake timeout')); }, 5000);
    socket.once('error', reject);
    socket.once('open', () => socket.send(JSON.stringify({ type: 'connection_init', payload: params })));
    socket.once('message', raw => { clearTimeout(timeout); expect(JSON.parse(raw.toString()).type).toBe('connection_ack'); resolve(socket); });
    socket.once('close', code => { clearTimeout(timeout); resolve(code); });
  });
}

it('authenticates WebSocket sessions only from APP_URL, and API keys via connectionParams', async () => {
  running = await boot();
  const owner = await setupOwner(running.h);
  const session = await running.app.services.auth.login({ login: 'owner', password: PASSWORD }, {});
  const cookie = `vel_session=${session.token}`;
  expect(await connect(running.base, { cookie, origin: 'https://attacker.example' })).toBe(4403);
  expect(await connect(running.base, { cookie })).toBe(4403);
  expect(await connect(running.base, { origin: running.h.config.appUrl })).toBe(4403);
  const socket = await connect(running.base, { cookie, origin: running.h.config.appUrl });
  expect(socket).toBeInstanceOf(WebSocket);
  if (typeof socket !== 'number') socket.close();
  const key = await running.app.services.apiKeys.create(owner, { name: 'ws', scope: 'read' });
  const apiSocket = await connect(running.base, {}, { authorization: key.plaintext });
  expect(apiSocket).toBeInstanceOf(WebSocket);
  if (typeof apiSocket !== 'number') apiSocket.close();
  expect(await connect(running.base, {}, { authorization: 'vel_invalid' })).toBe(4403);
});

it('delivers an HTTP issue mutation to an authenticated subscription', async () => {
  running = await boot();
  const owner = await setupOwner(running.h);
  const team = await running.app.services.teams.create(owner, { key: 'WS', name: 'WebSocket' });
  const issue = await running.app.services.issues.create(owner, { teamId: team.id, title: 'Before' });
  const key = await running.app.services.apiKeys.create(owner, { name: 'realtime', scope: 'write' });
  const socket = await connect(running.base, {}, { authorization: key.plaintext });
  if (typeof socket === 'number') throw new Error(`WebSocket rejected: ${socket}`);
  const received = new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Subscription event timeout')), 5000);
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString()) as { type: string; payload?: unknown };
      if (message.type === 'next') { clearTimeout(timeout); resolve(message.payload); }
    });
  });
  socket.send(JSON.stringify({ id: 'event', type: 'subscribe', payload: { query: `subscription { issueUpdated(issueId: "${issue.id}") { id title } }` } }));
  // A protocol ping is an ordering barrier after the subscribe frame.
  await new Promise<void>(resolve => { socket.once('pong', () => resolve()); socket.ping(); });
  const result = await running.gql('mutation($id: ID!) { updateIssue(id:$id, input:{ title:"After" }) { id } }', { id: issue.id }, { authorization: key.plaintext });
  expect(result.body.errors).toBeUndefined();
  expect(await received).toMatchObject({ data: { issueUpdated: { id: issue.id, title: 'After' } } });
  socket.close();
});

it('requires both MCP credentials, binds sessions to keys, and executes tools over HTTP', async () => {
  const app = testConfig({ mcp: { httpEnabled: true, httpToken: 'transport-token' } });
  running = await boot({ app });
  const owner = await setupOwner(running.h);
  const key = await running.app.services.apiKeys.create(owner, { name: 'mcp', scope: 'write' });
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
  for (const headers of [{}, { authorization: 'Bearer transport-token' }, { authorization: 'Bearer wrong', 'x-api-key': key.plaintext }, { authorization: 'Bearer transport-token', 'x-api-key': 'vel_invalid' }] as Record<string, string>[]) {
    expect((await fetch(`${running.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(init) })).status).toBe(401);
  }
  const transport = new StreamableHTTPClientTransport(new URL(`${running.base}/mcp`), { requestInit: { headers: { authorization: 'Bearer transport-token', 'x-api-key': key.plaintext } } });
  const client = new Client({ name: 'integration-test', version: '1' });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(13);
    expect((await client.callTool({ name: 'list_teams', arguments: {} })).isError).not.toBe(true);
    const otherKey = await running.app.services.apiKeys.create(owner, { name: 'other', scope: 'write' });
    expect((await fetch(`${running.base}/mcp`, { method: 'DELETE', headers: { authorization: 'Bearer transport-token', 'x-api-key': otherKey.plaintext, 'mcp-session-id': transport.sessionId! } })).status).toBe(403);
    await transport.terminateSession();
  } finally { await client.close(); }
});
