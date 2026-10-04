/** Anything that can run a GraphQL document against the Velocity API. */
export type GraphQLExecutor = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<{ data?: unknown; errors?: { message: string; extensions?: Record<string, unknown> }[] }>;

export interface HttpExecutorOptions {
  /** Server base URL, e.g. http://localhost (the executor appends /graphql). */
  url: string;
  apiKey: string;
  /** Session id from startMcpSession; sent as X-MCP-Session-Id for the audit trail. */
  mcpSessionId?: string | null;
  fetch?: typeof fetch;
}

type ExecResult = Awaited<ReturnType<GraphQLExecutor>>;

const STATUS_CODES: Record<number, string> = {
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** POSTs documents to `${url}/graphql`, authenticating with the API key. */
export function createHttpExecutor(opts: HttpExecutorOptions): GraphQLExecutor {
  const base = opts.url.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;
  return async (query, variables) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: opts.apiKey,
    };
    if (opts.mcpSessionId) headers['x-mcp-session-id'] = opts.mcpSessionId;
    const res = await doFetch(`${base}/graphql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables: variables ?? {} }),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Invalid JSON is handled by the generic response path below.
    }
    if (isRecord(body) && (body.data !== undefined || Array.isArray(body.errors))) {
      const out: ExecResult = {};
      if (body.data !== undefined) out.data = body.data;
      if (Array.isArray(body.errors)) out.errors = body.errors as NonNullable<ExecResult['errors']>;
      if (res.ok || out.errors) return out;
    }
    if (!res.ok) {
      const code = STATUS_CODES[res.status];
      const message = `Velocity server responded ${res.status} ${res.statusText}`.trim();
      return { errors: [{ message, ...(code ? { extensions: { code } } : {}) }] };
    }
    throw new Error('Velocity server returned an unexpected (non-GraphQL) response.');
  };
}
