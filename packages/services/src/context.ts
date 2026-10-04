import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { ActorKind, ActorRef } from '@velocity/events';
import type { Actor } from './lib/permissions';
import type { Db } from './db';
import type { JobQueue } from './jobs';
import type { StorageDriver } from './storage';

export interface AppConfig {
  appUrl: string;
  appSecret: string;
  uploadDir: string;
  maxUploadMb: number;
  exportDir: string;
  allowPrivateWebhookTargets: boolean;
  disableSignup: boolean;
  github: {
    appId: string | null;
    privateKey: string | null;
    webhookSecret: string | null;
    clientSecret: string | null;
    appSlug: string | null;
  };
  mcp: { httpEnabled: boolean; httpToken: string | null };
  /** Optional ClamAV daemon for upload scanning (SPEC §7.1.3). */
  clamav: { host: string; port: number } | null;
}

/**
 * The actor every service method receives (SPEC §7.1.4: "every resolver gets an authenticated
 * actor"). Humans, API keys, MCP sessions and background jobs share one model.
 */
export interface ServiceActor extends Actor {
  kind: ActorKind;
  apiKeyId?: string | null;
  mcpSessionId?: string | null;
  ip?: string | null;
}

/** Background/system actor (jobs, GitHub automation, importer). Has no user. */
export function systemActor(kind: 'system' | 'github' | 'import' = 'system', onBehalfOf?: string | null): ServiceActor {
  return {
    userId: onBehalfOf ?? '',
    isOwner: true,
    suspended: false,
    via: 'session',
    scope: 'write',
    kind,
  };
}

export function actorUserId(actor: ServiceActor): string | null {
  return actor.userId ? actor.userId : null;
}

export function toActorRef(actor: ServiceActor): ActorRef {
  return {
    kind: actor.kind,
    userId: actorUserId(actor),
    apiKeyId: actor.apiKeyId ?? null,
    mcpSessionId: actor.mcpSessionId ?? null,
  };
}

export interface ServiceDeps {
  db: Db;
  pool: Pool;
  config: AppConfig;
  jobs: JobQueue;
  storage: StorageDriver;
  logger: Logger;
  /** Injectable clock for tests (cycle rotation, retention). */
  now?: () => Date;
}
