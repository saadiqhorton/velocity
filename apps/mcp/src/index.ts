import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHttpExecutor, createVelocityMcpServer } from '@velocity/mcp-tools';
import type { GraphQLExecutor } from '@velocity/mcp-tools';

const VERSION = '1.0.0';

/** stdout is reserved for MCP protocol frames; everything human-readable goes to stderr. */
function log(msg: string): void {
  process.stderr.write(`[velocity-mcp] ${msg}\n`);
}

function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

async function startSession(url: string, apiKey: string, clientName: string): Promise<string | null> {
  const exec = createHttpExecutor({ url, apiKey });
  try {
    const res = await exec(
      'mutation StartMcpSession($clientName: String, $transport: String) { startMcpSession(clientName: $clientName, transport: $transport) }',
      { clientName, transport: 'stdio' },
    );
    if (res.errors?.length) {
      const first = res.errors[0];
      const code = typeof first?.extensions?.code === 'string' ? first.extensions.code : '';
      if (code === 'UNAUTHENTICATED') fail(`Velocity rejected VELOCITY_API_KEY (${first?.message}). Create a key in Settings > API keys.`);
      log(`startMcpSession failed (${first?.message}); continuing without an audit session id.`);
      return null;
    }
    const id = (res.data as { startMcpSession?: string } | undefined)?.startMcpSession;
    return typeof id === 'string' ? id : null;
  } catch (e) {
    log(`Could not reach Velocity at ${url}: ${e instanceof Error ? e.message : String(e)}. Check VELOCITY_URL; tool calls will report errors until it is reachable.`);
    return null;
  }
}

async function main(): Promise<void> {
  const url = (process.env.VELOCITY_URL?.trim() || 'http://localhost').replace(/\/+$/, '');
  const apiKey = process.env.VELOCITY_API_KEY?.trim();
  if (!apiKey) {
    fail(
      [
        'velocity-mcp: VELOCITY_API_KEY is required.',
        '',
        'Create an API key in Velocity (Settings > API keys), then set:',
        '  VELOCITY_API_KEY=vel_...        (use a read-scoped key for read-only agents)',
        '  VELOCITY_URL=https://velocity.example.com   (default: http://localhost)',
      ].join('\n'),
    );
  }

  // The session is started once the client has introduced itself (initialize), so the audit
  // trail records its real name. Tool calls wait for it (at most one round trip).
  let executor: GraphQLExecutor = createHttpExecutor({ url, apiKey });
  let ready: Promise<void> = Promise.resolve();
  const proxy: GraphQLExecutor = async (q, v) => {
    await ready;
    return executor(q, v);
  };
  const server = createVelocityMcpServer({ executor: proxy, version: VERSION });
  server.server.oninitialized = () => {
    const clientName = server.server.getClientVersion()?.name ?? 'mcp-stdio-client';
    ready = startSession(url, apiKey, clientName).then((sessionId) => {
      if (sessionId) {
        executor = createHttpExecutor({ url, apiKey, mcpSessionId: sessionId });
        log(`session ${sessionId} started for ${clientName} against ${url}`);
      }
    });
  };
  await server.connect(new StdioServerTransport());
  log('ready on stdio');

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e: unknown) => fail(`velocity-mcp: ${e instanceof Error ? e.message : String(e)}`));
