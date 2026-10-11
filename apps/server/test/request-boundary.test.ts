import { afterEach, describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { clientIp } from '../src/http/util';
import { boot } from './helpers';
import type { RunningApp } from './helpers';

let running: RunningApp | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

const req = (headers: Record<string, string>, remoteAddress = '10.0.0.5') => ({ headers, socket: { remoteAddress } }) as unknown as IncomingMessage;

describe('request boundary', () => {
  it('identifies the client by the hop the proxy appended, not by a header the client supplied', () => {
    // Caddy appends the address it saw; everything before that is client-supplied and forgeable.
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }), true)).toBe('203.0.113.9');
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.9' }), true)).toBe('203.0.113.9');
    expect(clientIp(req({ 'x-forwarded-for': '   ' }), true)).toBe('10.0.0.5');
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }), false)).toBe('10.0.0.5');
    expect(clientIp(req({}), true)).toBe('10.0.0.5');
  });

  it('refuses a POST to /graphql whose size cannot be measured before the body is read', async () => {
    running = await boot();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ query: '{ viewer { id } }' })));
        controller.close();
      },
    });
    const chunked = await fetch(`${running.base}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(chunked.status).toBe(411);
    // A request that declares its length up front is unaffected.
    const ok = await running.gql('{ viewer { id } }');
    expect(ok.response.status).toBe(200);
  });
});
