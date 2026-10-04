import type { Logger } from 'pino';
import type { Pool } from 'pg';
import type { AppConfig, ServiceDeps } from './context';
import type { Db, Tx } from './db';
import type { JobQueue } from './jobs';
import type { StorageDriver } from './storage';

export abstract class ServiceBase {
  protected readonly db: Db;
  protected readonly pool: Pool;
  protected readonly config: AppConfig;
  protected readonly jobs: JobQueue;
  protected readonly storage: StorageDriver;
  protected readonly logger: Logger;
  private readonly clock: () => Date;

  constructor(protected readonly deps: ServiceDeps) {
    this.db = deps.db;
    this.pool = deps.pool;
    this.config = deps.config;
    this.jobs = deps.jobs;
    this.storage = deps.storage;
    this.logger = deps.logger;
    this.clock = deps.now ?? (() => new Date());
  }

  protected now(): Date {
    return this.clock();
  }

  protected tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }
}
