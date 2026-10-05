import type { Server } from 'node:http';
// Match Pothos/Yoga's CJS GraphQL instance under both tsx and Vitest.
import { GraphQLError, Kind, getOperationAST, parse, specifiedRules, visit } from 'graphql/index.js';
import type { DocumentNode, ExecutionArgs, OperationDefinitionNode } from 'graphql';
import { createYoga } from 'graphql-yoga';
import type { Plugin, YogaInitialContext } from 'graphql-yoga';
import { useServer } from 'graphql-ws/use/ws';
import { WebSocketServer } from 'ws';
import type { Logger } from 'pino';
import { complexityLimitRule, createLoaders, depthLimitRule, schema, toGraphQLError } from '@velocity/graphql';
import type { GqlContext, VelocityPubSub } from '@velocity/graphql';
import type { ServiceActor, Services } from '@velocity/services';
import { memberActor } from '@velocity/services';
import type { ServerConfig } from './config';
import { graphqlDuration, rateLimited, wsConnections } from './metrics';
import { RateLimiter } from './rate-limit';
import type { RateDecision } from './rate-limit';

export const SESSION_COOKIE = 'vel_session';
export const CSRF_COOKIE = 'vel_csrf';

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { httpOnly: boolean; secure: boolean; expires?: Date; maxAge?: number; path?: string },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`, 'SameSite=Lax'];
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join('; ');
}

export function extractApiKey(headers: { get(name: string): string | null }): string | null {
  const auth = headers.get('authorization');
  if (auth) {
    const v = auth.replace(/^Bearer\s+/i, '').trim();
    if (v.startsWith('vel_')) return v;
  }
  const x = headers.get('x-api-key');
  return x && x.startsWith('vel_') ? x.trim() : null;
}

export interface Authenticated {
  actor: ServiceActor | null;
  sessionId: string | null;
  sessionToken: string | null;
  csrfToken: string | null;
  method: 'session' | 'api_key' | 'none';
}

const unauth = (message: string, status = 401) => new GraphQLError(message, { extensions: { code: 'UNAUTHENTICATED', http: { status } } });

/** Shared authentication for HTTP, WebSocket and in-process (MCP) requests (SPEC §6.2, §7.1.2). */
export async function authenticate(
  services: Services,
  headers: { get(name: string): string | null },
  ip: string | null,
): Promise<Authenticated> {
  const apiKey = extractApiKey(headers);
  if (apiKey) {
    const res = await services.auth.resolveApiKey(apiKey);
    if (!res) throw unauth('That API key is invalid, expired or revoked.');
    const actor: ServiceActor = {
      userId: res.user.id,
      isOwner: res.user.isOwner,
      suspended: Boolean(res.user.suspendedAt),
      via: 'api_key',
      scope: res.apiKey.scope,
      kind: 'api_key',
      apiKeyId: res.apiKey.id,
      ip,
    };
    const mcpSession = headers.get('x-mcp-session-id');
    if (mcpSession && /^[0-9a-f-]{36}$/i.test(mcpSession) && (await services.auth.touchMcpSession(mcpSession, res.user.id))) {
      actor.via = 'mcp';
      actor.kind = 'mcp';
      actor.mcpSessionId = mcpSession;
    }
    return { actor, sessionId: null, sessionToken: null, csrfToken: null, method: 'api_key' };
  }
  const token = parseCookies(headers.get('cookie'))[SESSION_COOKIE];
  if (token) {
    const res = await services.auth.resolveSession(token);
    if (res) {
      return { actor: { ...memberActor(res.user), ip }, sessionId: res.session.id, sessionToken: token, csrfToken: res.session.csrfToken, method: 'session' };
    }
  }
  return { actor: null, sessionId: null, sessionToken: null, csrfToken: null, method: 'none' };
}

const AUTH_FIELDS = new Set(['login', 'setupWorkspace', 'acceptInvite', 'signup']);

// Memoized: the same query strings arrive every request; re-parsing them each
// time showed up in CPU profiles of the hot list path (SPEC §4.16).
const authOperationCache = new Map<string, boolean>();

function hasAuthOperation(query: string): boolean {
  const cached = authOperationCache.get(query);
  if (cached !== undefined) return cached;
  let found = false;
  try {
    visit(parse(query), { Field(node) { if (AUTH_FIELDS.has(node.name.value)) found = true; } });
  } catch {
    found = false; // Yoga returns the syntax error without executing a resolver.
  }
  if (authOperationCache.size >= 1_000) authOperationCache.clear();
  authOperationCache.set(query, found);
  return found;
}

interface PerRequest {
  cookies: string[];
  rate: RateDecision | null;
}

export interface GraphQLServer {
  yoga: ReturnType<typeof createYoga<Record<string, unknown>, GqlContext>>;
  attachWebSocket(server: Server): WebSocketServer;
  /** In-process executor used by the MCP HTTP transport — goes through the full request pipeline. */
  execute(query: string, variables: Record<string, unknown> | undefined, headers: Record<string, string>): Promise<{ data?: unknown; errors?: { message: string; extensions?: Record<string, unknown> }[] }>;
}

export function createGraphQLServer(opts: { services: Services; pubsub: VelocityPubSub; config: ServerConfig; logger: Logger }): GraphQLServer {
  const { services, pubsub, config, logger } = opts;
  const limiter = new RateLimiter(config.rateLimit.perMinute, config.rateLimit.burstPerSecond);
  const authLimiter = new RateLimiter(10, 10);
  const perRequest = new WeakMap<Request, PerRequest>();
  const origin = new URL(config.app.appUrl).origin;

  const buildContext = async (request: Request): Promise<GqlContext> => {
    const ip = request.headers.get('x-velocity-client-ip');
    const state: PerRequest = { cookies: [], rate: null };
    perRequest.set(request, state);
    const auth = await authenticate(services, request.headers, ip);

    // CSRF double-submit for cookie-authenticated POSTs (SPEC §7.1.2).
    if (auth.method === 'session' && request.method === 'POST') {
      const header = request.headers.get('x-csrf-token');
      if (!header || header !== auth.csrfToken) {
        throw new GraphQLError('Missing or invalid CSRF token. Reload the page and try again.', { extensions: { code: 'FORBIDDEN', http: { status: 403 } } });
      }
    }

    // Rate limits (SPEC §6.3): per key / per member; strict per-IP for credential endpoints.
    const key = auth.actor ? `${auth.method}:${auth.actor.apiKeyId ?? auth.actor.userId}` : `ip:${ip ?? 'unknown'}`;
    const decision = limiter.check(key);
    state.rate = decision;
    if (!decision.allowed) {
      rateLimited.inc({ kind: auth.method });
      throw new GraphQLError(`Rate limit exceeded. Retry in ${decision.retryAfter}s.`, {
        extensions: { code: 'RATE_LIMITED', retryAfter: decision.retryAfter, http: { status: 429, headers: { 'retry-after': String(decision.retryAfter) } } },
      });
    }

    return {
      services,
      pubsub,
      actor: auth.actor,
      sessionId: auth.sessionId,
      sessionToken: auth.sessionToken,
      loaders: createLoaders(services, auth.actor),
      request: {
        ip,
        userAgent: request.headers.get('user-agent'),
        setSession(token, csrfToken, expiresAt) {
          state.cookies.push(serializeCookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.secureCookies, expires: expiresAt }));
          state.cookies.push(serializeCookie(CSRF_COOKIE, csrfToken, { httpOnly: false, secure: config.secureCookies, expires: expiresAt }));
        },
        clearSession() {
          state.cookies.push(serializeCookie(SESSION_COOKIE, '', { httpOnly: true, secure: config.secureCookies, maxAge: 0 }));
          state.cookies.push(serializeCookie(CSRF_COOKIE, '', { httpOnly: false, secure: config.secureCookies, maxAge: 0 }));
        },
      },
    };
  };

  const velocityPlugin: Plugin<Record<string, unknown>, GqlContext> = {
    onValidate({ addValidationRule }) {
      addValidationRule(depthLimitRule(10));
      addValidationRule(complexityLimitRule(50_000));
    },
    onParams({ params, request }) {
      // Credential endpoints: 10/min per IP (SPEC §6.3), checked before anything else runs.
      if (params.query && hasAuthOperation(params.query)) {
        const ip = request.headers.get('x-velocity-client-ip') ?? 'unknown';
        const d = authLimiter.check(`auth:${ip}`);
        if (!d.allowed) {
          rateLimited.inc({ kind: 'auth' });
          throw new GraphQLError(`Too many sign-in attempts. Retry in ${d.retryAfter}s.`, {
            extensions: { code: 'RATE_LIMITED', retryAfter: d.retryAfter, http: { status: 429, headers: {
              'retry-after': String(d.retryAfter),
              'x-ratelimit-limit': String(d.limit),
              'x-ratelimit-remaining': String(d.remaining),
              'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + d.resetSeconds),
            } } },
          });
        }
      }
    },
    onExecute({ args }) {
      const op = getOperationAST(args.document, args.operationName ?? undefined);
      const fields = rootFields(op);
      const started = performance.now();
      const ctx = args.contextValue as unknown as GqlContext;
      return {
        async onExecuteDone() {
          const secs = (performance.now() - started) / 1000;
          for (const f of fields.slice(0, 3)) graphqlDuration.observe({ type: op?.operation ?? 'unknown', field: f }, secs);
          // Agent-facing hardening (SPEC §7.1.6): attribute every API-key/MCP mutation.
          if (op?.operation === 'mutation' && ctx.actor && ctx.actor.via !== 'session') {
            await services.audit.logMutation(services.deps.db, ctx.actor, fields.join(',').slice(0, 200)).catch((err) => logger.warn({ err }, 'audit log failed'));
          }
        },
      };
    },
    onResponse({ request, response }) {
      const state = perRequest.get(request);
      if (!state) return;
      for (const c of state.cookies) response.headers.append('set-cookie', c);
      if (state.rate) {
        response.headers.set('x-ratelimit-limit', String(state.rate.limit));
        response.headers.set('x-ratelimit-remaining', String(state.rate.remaining));
        response.headers.set('x-ratelimit-reset', String(state.rate.resetSeconds));
      }
    },
  };

  const yoga = createYoga<Record<string, unknown>, GqlContext>({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: false,
    landingPage: false,
    cors: false,
    logging: {
      debug: (...a) => logger.debug(a.map(String).join(' ')),
      info: (...a) => logger.info(a.map(String).join(' ')),
      warn: (...a) => logger.warn(a.map(String).join(' ')),
      // Client errors (auth, validation) are expected; unexpected ones are logged by maskError.
      error: (...a) => logger.debug(a.map(String).join(' ')),
    },
    context: async ({ request }: YogaInitialContext) => buildContext(request),
    maskedErrors: {
      maskError(error, message) {
        const original = error instanceof GraphQLError ? (error.originalError ?? error) : error;
        const mapped = toGraphQLError(original);
        if (mapped) {
          return new GraphQLError(mapped.message, {
            nodes: error instanceof GraphQLError ? error.nodes : undefined,
            path: error instanceof GraphQLError ? error.path : undefined,
            extensions: mapped.extensions,
          });
        }
        if (error instanceof GraphQLError && !error.originalError) return error;
        logger.error({ err: original }, 'unexpected GraphQL error');
        return new GraphQLError(message, { extensions: { code: 'INTERNAL_SERVER_ERROR' } });
      },
    },
    plugins: [velocityPlugin],
  });

  return {
    yoga,
    attachWebSocket(server: Server) {
      const wss = new WebSocketServer({ server, path: '/graphql' });
      useServer(
        {
          // Cookie-authenticated sockets must come from our own origin (cross-site WS hijacking).
          onConnect: async (ctx) => {
            const req = ctx.extra.request;
            const headers = new Headers();
            for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
            const params = (ctx.connectionParams ?? {}) as Record<string, unknown>;
            if (typeof params.authorization === 'string') headers.set('authorization', params.authorization);
            if (typeof params['x-mcp-session-id'] === 'string') headers.set('x-mcp-session-id', params['x-mcp-session-id'] as string);
            const usesCookie = !extractApiKey(headers);
            if (usesCookie && headers.get('origin') !== origin) return false;
            const ip = (req.headers['x-velocity-client-ip'] as string | undefined) ?? req.socket.remoteAddress ?? null;
            try {
              const auth = await authenticate(services, headers, ip);
              if (!auth.actor) return false;
              (ctx.extra as unknown as { auth: Authenticated }).auth = auth;
              wsConnections.inc();
              return true;
            } catch {
              return false;
            }
          },
          onDisconnect: (ctx) => {
            if ((ctx.extra as unknown as { auth?: Authenticated }).auth) wsConnections.dec();
          },
          onSubscribe: async (ctx, _id, payload) => {
            const auth = (ctx.extra as unknown as { auth: Authenticated }).auth;
            const { schema: s, execute, subscribe, parse, validate } = yoga.getEnveloped({});
            const document: DocumentNode = parse(payload.query);
            const operation = getOperationAST(document, payload.operationName);
            if (operation?.operation !== 'subscription') {
              return [new GraphQLError('WebSocket connections only support subscriptions.', { extensions: { code: 'FORBIDDEN' } })];
            }
            const errors = validate(s, document, [...specifiedRules, depthLimitRule(10), complexityLimitRule(50_000)]);
            if (errors.length) return errors;
            const contextValue: GqlContext = {
              services,
              pubsub,
              actor: auth.actor,
              sessionId: auth.sessionId,
              sessionToken: auth.sessionToken,
              loaders: createLoaders(services, auth.actor),
              request: { ip: auth.actor?.ip ?? null, userAgent: null, setSession() {}, clearSession() {} },
            };
            const args: ExecutionArgs & { rootValue: { execute: typeof execute; subscribe: typeof subscribe } } = {
              schema: s,
              document,
              operationName: payload.operationName,
              variableValues: payload.variables,
              contextValue,
              rootValue: { execute, subscribe },
            };
            return args;
          },
          execute: (args) => (args.rootValue as { execute: (a: ExecutionArgs) => never }).execute(args),
          subscribe: (args) => (args.rootValue as { subscribe: (a: ExecutionArgs) => never }).subscribe(args),
        },
        wss,
      );
      return wss;
    },
    async execute(query, variables, headers) {
      const res = await yoga.fetch('http://internal/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ query, variables }),
      });
      return (await res.json()) as { data?: unknown; errors?: { message: string; extensions?: Record<string, unknown> }[] };
    },
  };
}

function rootFields(op: OperationDefinitionNode | null | undefined): string[] {
  if (!op) return [];
  return op.selectionSet.selections.filter((s) => s.kind === Kind.FIELD).map((s) => (s.kind === Kind.FIELD ? s.name.value : ''));
}
