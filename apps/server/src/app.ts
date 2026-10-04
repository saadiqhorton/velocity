import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import pino from 'pino';
import type { Logger } from 'pino';
import type { WebSocketServer } from 'ws';
import { createVelocityPubSub } from '@velocity/graphql';
import { runMigrations } from '@velocity/schema/migrate';
import { LocalDiskDriver, MemoryJobQueue, createDb, createServices } from '@velocity/services';
import type { JobQueue, Services } from '@velocity/services';
import type { OutboxListener } from '@velocity/events';
import type { ServerConfig } from './config';
import { createGraphQLServer } from './graphql-server';
import type { GraphQLServer } from './graphql-server';
import { handleExportDownload, handleFile } from './http/files';
import { handleGithubSetup, handleGithubWebhook } from './http/github';
import { createMcpHandler } from './http/mcp';
import { createStaticHandler } from './http/static';
import { SECURITY_HEADERS, clientIp, sendJson, sendText } from './http/util';
import { PgBossJobQueue, startBoss, startWorkers } from './jobs';
import { httpDuration, registry } from './metrics';
import { startRealtime } from './realtime';

export interface App {
  config: ServerConfig;
  logger: Logger;
  pool: pg.Pool;
  services: Services;
  gql: GraphQLServer;
  server: Server;
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
}

export function createLogger(level: string): Logger {
  // PII/secret scrubbing (SPEC §7.1.3, §7.4).
  return pino({
    level,
    base: { service: 'velocity' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        '*.password',
        '*.newPassword',
        '*.currentPassword',
        '*.apiKey',
        '*.token',
        '*.secret',
        'headers.authorization',
        'headers.cookie',
      ],
      censor: '[redacted]',
    },
  });
}

function migrationsFolder(): string | undefined {
  // Bundled build ships SQL next to dist/main.js; in dev the schema package resolves its own.
  if (fileURLToPath(import.meta.url).endsWith('main.js')) return fileURLToPath(new URL('./migrations', import.meta.url));
  return undefined;
}

async function backupDatabase(config: ServerConfig, logger: Logger): Promise<void> {
  mkdirSync(config.backupDir, { recursive: true });
  const file = join(config.backupDir, `velocity-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  logger.info({ file }, 'backing up database before migrating');
  await new Promise<void>((resolve, reject) => {
    const p = spawn('pg_dump', ['--format=custom', `--file=${file}`, `--dbname=${config.databaseUrl}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += String(d)));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump failed (${code}): ${err.slice(0, 500)}`))));
  });
}

function routeLabel(pathname: string): string {
  if (pathname === '/graphql') return '/graphql';
  if (pathname.startsWith('/files/')) return '/files/:id';
  if (pathname.startsWith('/api/')) return pathname.split('/').slice(0, 3).join('/');
  if (pathname.startsWith('/assets/')) return '/assets/*';
  if (['/healthz', '/readyz', '/metrics', '/mcp'].includes(pathname)) return pathname;
  return 'spa';
}

export async function createApp(config: ServerConfig, opts: { logger?: Logger; inlineJobs?: boolean } = {}): Promise<App> {
  const logger = opts.logger ?? createLogger(config.logLevel);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, application_name: `velocity-${config.role}` });
  pool.on('error', (err) => logger.error({ err }, 'postgres pool error'));

  if (config.role !== 'worker') {
    if (config.backupBeforeMigrate) await backupDatabase(config, logger);
    await runMigrations(pool, migrationsFolder());
    logger.info('migrations up to date');
  }

  mkdirSync(config.app.uploadDir, { recursive: true });
  mkdirSync(config.app.exportDir, { recursive: true });

  let boss: PgBoss | null = null;
  let jobs: JobQueue;
  if (opts.inlineJobs) jobs = new MemoryJobQueue();
  else {
    boss = await startBoss(config.databaseUrl, logger);
    jobs = new PgBossJobQueue(boss);
  }

  const services = createServices({
    db: createDb(pool),
    pool,
    config: config.app,
    jobs,
    storage: new LocalDiskDriver(config.app.uploadDir),
    logger,
  });

  const pubsub = createVelocityPubSub();
  const gql = createGraphQLServer({ services, pubsub, config, logger });

  // Side effects (notifications, webhooks) run where jobs run; debounce NOTIFY bursts.
  const runsJobs = config.role !== 'web';
  let drainTimer: NodeJS.Timeout | null = null;
  const scheduleDrain = () => {
    if (!runsJobs || drainTimer) return;
    drainTimer = setTimeout(() => {
      drainTimer = null;
      services.events.drain().catch((err) => logger.error({ err }, 'outbox drain failed'));
    }, 50);
  };
  const listener: OutboxListener = await startRealtime(pool, pubsub, logger, scheduleDrain);
  const drainInterval = runsJobs ? setInterval(scheduleDrain, 5000) : null;
  drainInterval?.unref();
  if (boss && runsJobs) await startWorkers(boss, services, logger, { auditRetentionDays: config.auditRetentionDays });

  const staticHandler = config.role === 'worker' ? null : createStaticHandler(config.webDistDir);
  const mcpHandler = config.app.mcp.httpEnabled && config.app.mcp.httpToken ? createMcpHandler({ gql, token: config.app.mcp.httpToken, logger }) : null;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://local');
    const pathname = url.pathname;
    const ip = clientIp(req, config.trustProxy);
    // Our own trusted header for downstream (yoga/context) — never accept a client-supplied one.
    delete req.headers['x-velocity-client-ip'];
    if (ip) req.headers['x-velocity-client-ip'] = ip;

    if (pathname === '/healthz') return sendJson(res, 200, { ok: true });
    if (pathname === '/readyz') {
      try {
        await pool.query('select 1');
        await services.deps.storage.check();
        return sendJson(res, 200, { ok: true, role: config.role });
      } catch (err) {
        logger.warn({ err }, 'readiness check failed');
        return sendJson(res, 503, { ok: false });
      }
    }
    if (pathname === '/metrics') {
      const auth = req.headers.authorization ?? '';
      if (config.metricsToken ? auth !== `Bearer ${config.metricsToken}` : Boolean(req.headers['x-forwarded-for'])) {
        return sendText(res, 403, 'Forbidden');
      }
      res.writeHead(200, { 'content-type': registry.contentType });
      res.end(await registry.metrics());
      return;
    }
    if (config.role === 'worker') return sendText(res, 404, 'Not found (worker role)');
    if (pathname === '/graphql') {
      const len = Number(req.headers['content-length'] ?? 0);
      if (len > (config.app.maxUploadMb + 1) * 1024 * 1024) return sendJson(res, 413, { errors: [{ message: 'Request too large.', extensions: { code: 'VALIDATION' } }] });
      // The adapter is itself a Node request listener (writes the response).
      await gql.yoga.requestListener(req, res);
      return;
    }
    if (pathname.startsWith('/files/')) return handleFile(services, req, res, url, ip);
    if (/^\/api\/exports\/[0-9a-f-]{36}\/download$/i.test(pathname)) return handleExportDownload(services, req, res, url, ip);
    if (pathname === '/api/github/webhook') return handleGithubWebhook(services, logger, req, res);
    if (pathname === '/api/github/setup') return handleGithubSetup(res, url);
    if (pathname === '/mcp') {
      if (!mcpHandler) return sendJson(res, 404, { error: 'The MCP HTTP transport is disabled. Set MCP_HTTP_ENABLED=1 and MCP_HTTP_TOKEN.' });
      return mcpHandler(req, res, ip);
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    staticHandler!(req, res, pathname);
  };

  const server = createServer((req, res) => {
    const started = performance.now();
    res.on('finish', () => {
      const path = new URL(req.url ?? '/', 'http://local').pathname;
      httpDuration.observe({ method: req.method ?? 'GET', route: routeLabel(path), status: String(res.statusCode) }, (performance.now() - started) / 1000);
    });
    handle(req, res).catch((err) => {
      logger.error({ err, url: req.url }, 'request failed');
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' }, SECURITY_HEADERS);
      else res.destroy();
    });
  });
  server.headersTimeout = 65_000;
  server.requestTimeout = 120_000;
  let wss: WebSocketServer | null = null;
  if (config.role !== 'worker') wss = gql.attachWebSocket(server);

  return {
    config,
    logger,
    pool,
    services,
    gql,
    server,
    listen: () =>
      new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          const addr = server.address();
          resolve({ port: typeof addr === 'object' && addr ? addr.port : config.port });
        });
      }),
    async close() {
      if (drainInterval) clearInterval(drainInterval);
      if (drainTimer) clearTimeout(drainTimer);
      await listener.stop();
      if (wss) {
        for (const c of wss.clients) c.terminate();
        await new Promise<void>((r) => wss!.close(() => r()));
      }
      await new Promise<void>((r) => server.close(() => r()));
      if (boss) await boss.stop({ graceful: true, timeout: 10_000 });
      await pool.end();
    },
  };
}
