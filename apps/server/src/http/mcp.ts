import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createVelocityMcpServer } from '@velocity/mcp-tools';
import { timingSafeEqual } from 'node:crypto';
import type { GraphQLServer } from '../graphql-server';
import { headerGetter, readBody, sendJson } from './util';

interface McpSession {
  transport: StreamableHTTPServerTransport;
  apiKey: string;
  lastSeen: number;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * MCP streamable-HTTP transport at /mcp (SPEC §6.6), on by default (MCP_HTTP_ENABLED=0 opts out):
 * a personal API key that becomes the actor, optionally behind the MCP_HTTP_TOKEN bearer. Tools run through the same GraphQL pipeline (auth, limits, audit) in-process.
 */
export function createMcpHandler(opts: { gql: GraphQLServer; token: string | null; logger: Logger }) {
  const sessions = new Map<string, McpSession>();
  const sweep = setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, s] of sessions) {
      if (s.lastSeen < cutoff) {
        void s.transport.close();
        sessions.delete(id);
      }
    }
  }, 5 * 60 * 1000);
  sweep.unref();

  return async (req: IncomingMessage, res: ServerResponse, ip: string | null): Promise<void> => {
    const headers = headerGetter(req);
    // Auth: the personal API key alone (X-Api-Key or `Authorization: Bearer vel_…`). When the
    // operator also set MCP_HTTP_TOKEN, that token must arrive as the Bearer and the key as X-Api-Key.
    const bearer = (headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    let apiKey: string | null;
    if (opts.token) {
      if (!bearer || !safeEqual(bearer, opts.token)) {
        return sendJson(res, 401, { jsonrpc: '2.0', error: { code: -32001, message: 'Missing or invalid MCP_HTTP_TOKEN bearer token.' }, id: null });
      }
      apiKey = headers.get('x-api-key');
    } else {
      apiKey = headers.get('x-api-key') ?? (bearer.startsWith('vel_') ? bearer : null);
    }
    if (!apiKey || !apiKey.startsWith('vel_')) {
      return sendJson(res, 401, { jsonrpc: '2.0', error: { code: -32001, message: 'Send a Velocity API key in the X-Api-Key header or as an Authorization: Bearer token.' }, id: null });
    }
    const sessionId = headers.get('mcp-session-id');
    let body: unknown;
    if (req.method === 'POST') {
      try {
        body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8'));
      } catch {
        return sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
      }
    }

    if (sessionId) {
      const s = sessions.get(sessionId);
      if (!s) return sendJson(res, 404, { jsonrpc: '2.0', error: { code: -32001, message: 'Unknown MCP session.' }, id: null });
      if (!safeEqual(s.apiKey, apiKey)) return sendJson(res, 403, { jsonrpc: '2.0', error: { code: -32001, message: 'API key does not match this session.' }, id: null });
      s.lastSeen = Date.now();
      await s.transport.handleRequest(req, res, body);
      return;
    }

    if (req.method !== 'POST' || !isInitializeRequest(body)) {
      return sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32000, message: 'Start with an initialize request.' }, id: null });
    }

    // Audit trail: one MCP session row per connection (SPEC §5.12 "MCP session start").
    const ipHeader: Record<string, string> = ip ? { 'x-velocity-client-ip': ip } : {};
    const clientName = (body as { params?: { clientInfo?: { name?: string } } }).params?.clientInfo?.name ?? 'mcp-http';
    const start = await opts.gql.execute(
      'mutation Start($c: String, $t: String) { startMcpSession(clientName: $c, transport: $t) }',
      { c: clientName, t: 'http' },
      { authorization: apiKey, ...ipHeader },
    );
    const auditSessionId = (start.data as { startMcpSession?: string } | undefined)?.startMcpSession;
    if (!auditSessionId) {
      return sendJson(res, 401, { jsonrpc: '2.0', error: { code: -32001, message: start.errors?.[0]?.message ?? 'Invalid API key.' }, id: null });
    }
    const executor = (query: string, variables?: Record<string, unknown>) =>
      opts.gql.execute(query, variables, { authorization: apiKey, 'x-mcp-session-id': auditSessionId, ...ipHeader });
    const server = createVelocityMcpServer({ executor });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, apiKey, lastSeen: Date.now() });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    opts.logger.info({ clientName, auditSessionId }, 'mcp http session started');
  };
}
