import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AppConfig } from '@velocity/services';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_URL: z.string().url(),
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters (try: openssl rand -hex 32)'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  WEB_DIST_DIR: z.string().optional(),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  EXPORT_DIR: z.string().default('./data/exports'),
  BACKUP_DIR: z.string().default('./data/backups'),
  BACKUP_ENABLED: z.string().optional(),
  BACKUP_SCHEDULE: z.string().min(1).default('0 3 * * *'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(1024).default(25),
  DISABLE_SIGNUP: bool(true),
  ALLOW_PRIVATE_WEBHOOK_TARGETS: bool(false),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  MCP_HTTP_ENABLED: bool(false),
  MCP_HTTP_TOKEN: z.string().optional(),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SENTRY_DSN: z.string().optional(),
  VELOCITY_ROLE: z.enum(['all', 'web', 'worker']).default('all'),
  VELOCITY_BACKUP_BEFORE_MIGRATE: bool(false),
  METRICS_TOKEN: z.string().optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(1000),
  RATE_LIMIT_BURST_PER_SECOND: z.coerce.number().int().positive().default(50),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  TRUST_PROXY: bool(false),
  NODE_ENV: z.string().default('development'),
});

export interface ServerConfig {
  app: AppConfig;
  databaseUrl: string;
  port: number;
  host: string;
  webDistDir: string;
  backupDir: string;
  /** Automatic nightly pg_dump (pg-boss cron). Retention prunes only `velocity-*.dump` files. */
  backup: { enabled: boolean; schedule: string; retentionDays: number };
  /** True when APP_SECRET was generated into APP_SECRET_FILE by this process. */
  appSecretGenerated: boolean;
  role: 'all' | 'web' | 'worker';
  backupBeforeMigrate: boolean;
  logLevel: string;
  metricsToken: string | null;
  rateLimit: { perMinute: number; burstPerSecond: number };
  auditRetentionDays: number;
  production: boolean;
  secureCookies: boolean;
  trustProxy: boolean;
}

/** Private keys in env often arrive with literal `\n` — normalize to real newlines. */
function pem(v: string | undefined): string | null {
  if (!v) return null;
  return v.includes('\\n') ? v.replace(/\\n/g, '\n') : v;
}

export interface SecretFs {
  readFileSync(path: string, enc: 'utf8'): string;
  writeFileSync(path: string, data: string, opts: { flag: string; mode: number }): void;
  mkdirSync(path: string, opts: { recursive: true }): unknown;
}
const realFs: SecretFs = { readFileSync, writeFileSync, mkdirSync };
const code = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code;

/**
 * APP_SECRET resolution: an explicit APP_SECRET wins; otherwise read APP_SECRET_FILE
 * (default /data/app-secret in production, ./data/app-secret elsewhere), creating it with
 * 32 random bytes (hex, mode 0600, `wx` so a racing process never overwrites) when absent.
 */
export function resolveAppSecret(
  env: NodeJS.ProcessEnv,
  fs: SecretFs = realFs,
): { secret: string | undefined; generated: boolean; file: string | null } {
  if (env.APP_SECRET) return { secret: env.APP_SECRET, generated: false, file: null };
  const file = resolve(env.APP_SECRET_FILE || (env.NODE_ENV === 'production' ? '/data/app-secret' : './data/app-secret'));
  const read = (): string | null => {
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch (err) {
      if (code(err) === 'ENOENT') return null;
      throw new Error(`Cannot read APP_SECRET_FILE ${file}: ${(err as Error).message}`, { cause: err });
    }
  };
  const existing = read();
  if (existing !== null) return { secret: existing, generated: false, file };
  try {
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    return { secret: read() ?? undefined, generated: true, file };
  } catch (err) {
    if (code(err) !== 'EEXIST') {
      throw new Error(`APP_SECRET is not set and ${file} could not be created (${(err as Error).message}). Set APP_SECRET (openssl rand -hex 32) or point APP_SECRET_FILE at a writable path.`, { cause: err });
    }
    // Another process (e.g. the worker role) won the race; it may still be mid-write.
    for (let i = 0; i < 20; i++) {
      const v = read();
      if (v) return { secret: v, generated: false, file };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    return { secret: read() ?? undefined, generated: false, file };
  }
}

/** APP_URL fallback: https://$CADDY_DOMAIN for a real hostname, else http://localhost. */
export function deriveAppUrl(env: NodeJS.ProcessEnv): string {
  const domain = (env.CADDY_DOMAIN ?? '').trim();
  if (domain && !domain.startsWith(':')) return `https://${domain}`;
  // Dev keeps the historical API port; production is fronted by Caddy on 80.
  return env.NODE_ENV === 'production' ? 'http://localhost' : 'http://localhost:3000';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, fs: SecretFs = realFs): ServerConfig {
  const sec = resolveAppSecret(env, fs);
  const merged: NodeJS.ProcessEnv = { ...env };
  if (sec.secret !== undefined) merged.APP_SECRET = sec.secret;
  for (const k of ['BACKUP_SCHEDULE', 'BACKUP_RETENTION_DAYS']) if (merged[k] === '') delete merged[k];
  if (!merged.APP_URL) merged.APP_URL = deriveAppUrl(env);
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    const hint = sec.file ? `\n(APP_SECRET was read from ${sec.file}.)` : '';
    throw new Error(`Invalid configuration:\n${msg}${hint}\nSee .env.example for every option.`);
  }
  const e = parsed.data;
  if (e.MCP_HTTP_ENABLED && (!e.MCP_HTTP_TOKEN || e.MCP_HTTP_TOKEN.length < 24)) {
    throw new Error('MCP_HTTP_ENABLED=1 requires MCP_HTTP_TOKEN (at least 24 characters).');
  }
  const here = fileURLToPath(new URL('.', import.meta.url));
  const appUrl = e.APP_URL.replace(/\/$/, '');
  return {
    app: {
      appUrl,
      appSecret: e.APP_SECRET,
      uploadDir: resolve(e.UPLOAD_DIR),
      maxUploadMb: e.MAX_UPLOAD_MB,
      exportDir: resolve(e.EXPORT_DIR),
      allowPrivateWebhookTargets: e.ALLOW_PRIVATE_WEBHOOK_TARGETS,
      disableSignup: e.DISABLE_SIGNUP,
      github: {
        appId: e.GITHUB_APP_ID || null,
        privateKey: pem(e.GITHUB_APP_PRIVATE_KEY),
        webhookSecret: e.GITHUB_WEBHOOK_SECRET || null,
        clientSecret: e.GITHUB_APP_CLIENT_SECRET || e.GITHUB_APP_SECRET || null,
        appSlug: e.GITHUB_APP_SLUG || null,
      },
      mcp: { httpEnabled: e.MCP_HTTP_ENABLED, httpToken: e.MCP_HTTP_TOKEN || null },
      clamav: e.CLAMAV_HOST ? { host: e.CLAMAV_HOST, port: e.CLAMAV_PORT } : null,
    },
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    host: e.HOST,
    // dist/main.js → ../../web/dist ; src/config.ts (dev) → ../../web/dist
    webDistDir: resolve(e.WEB_DIST_DIR ?? resolve(here, '../../web/dist')),
    backupDir: resolve(e.BACKUP_DIR),
    backup: {
      enabled: e.BACKUP_ENABLED === undefined || e.BACKUP_ENABLED === '' ? e.NODE_ENV === 'production' : ['1', 'true', 'yes', 'on'].includes(e.BACKUP_ENABLED.toLowerCase()),
      schedule: e.BACKUP_SCHEDULE,
      retentionDays: e.BACKUP_RETENTION_DAYS,
    },
    appSecretGenerated: sec.generated,
    role: e.VELOCITY_ROLE,
    backupBeforeMigrate: e.VELOCITY_BACKUP_BEFORE_MIGRATE,
    logLevel: e.LOG_LEVEL,
    metricsToken: e.METRICS_TOKEN || null,
    rateLimit: { perMinute: e.RATE_LIMIT_PER_MINUTE, burstPerSecond: e.RATE_LIMIT_BURST_PER_SECOND },
    auditRetentionDays: e.AUDIT_RETENTION_DAYS,
    production: e.NODE_ENV === 'production',
    secureCookies: appUrl.startsWith('https://'),
    trustProxy: e.TRUST_PROXY,
  };
}
