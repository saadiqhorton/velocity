import { afterEach, expect, it } from 'vitest';
import { setupOwner, testConfig } from '../../../packages/services/test/helpers/harness';
import { boot } from './helpers';
import type { RunningApp } from './helpers';

let running: RunningApp | undefined;
afterEach(async () => { await running?.close(); running = undefined; });

const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'auth-matrix', version: '1' } } };
const post = (base: string, headers: Record<string, string>) =>
  fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(init) });

it('without MCP_HTTP_TOKEN the API key alone authenticates (X-Api-Key or Bearer vel_)', async () => {
  running = await boot({ app: testConfig({ mcp: { httpEnabled: true, httpToken: null } }) });
  const owner = await setupOwner(running.h);
  const key = (await running.app.services.apiKeys.create(owner, { name: 'k', scope: 'write' })).plaintext;
  expect((await post(running.base, { 'x-api-key': key })).status).toBe(200);
  expect((await post(running.base, { authorization: `Bearer ${key}` })).status).toBe(200);
  expect((await post(running.base, {})).status).toBe(401);
  expect((await post(running.base, { authorization: 'Bearer not-a-key' })).status).toBe(401);
  expect((await post(running.base, { 'x-api-key': 'vel_invalid' })).status).toBe(401);
  expect((await post(running.base, { authorization: 'Bearer vel_invalid' })).status).toBe(401);
});

it('with MCP_HTTP_TOKEN the token is still enforced and the key must be in X-Api-Key', async () => {
  const token = 'defense-in-depth-token-1234567890';
  running = await boot({ app: testConfig({ mcp: { httpEnabled: true, httpToken: token } }) });
  const owner = await setupOwner(running.h);
  const key = (await running.app.services.apiKeys.create(owner, { name: 'k', scope: 'write' })).plaintext;
  expect((await post(running.base, { authorization: `Bearer ${token}`, 'x-api-key': key })).status).toBe(200);
  expect((await post(running.base, { 'x-api-key': key })).status).toBe(401);
  expect((await post(running.base, { authorization: `Bearer ${key}` })).status).toBe(401);
  expect((await post(running.base, { authorization: 'Bearer wrong', 'x-api-key': key })).status).toBe(401);
  expect((await post(running.base, { authorization: `Bearer ${token}` })).status).toBe(401);
});

it('MCP_HTTP_ENABLED=0 turns /mcp off', async () => {
  running = await boot({ app: testConfig({ mcp: { httpEnabled: false, httpToken: null } }) });
  expect((await post(running.base, { 'x-api-key': 'vel_x' })).status).toBe(404);
});
