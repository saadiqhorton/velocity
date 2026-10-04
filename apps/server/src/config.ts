import { resolve } from 'node:path';
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
  APP_URL: z.string().url().default('http://localhost:3000'),
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters (try: openssl rand -hex 32)'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  WEB_DIST_DIR: z.string().optional(),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  EXPORT_DIR: z.string().default('./data/exports'),
  BACKUP_DIR: z.string().default('./data/backups'),
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}\nSee .env.example for every option.`);
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
