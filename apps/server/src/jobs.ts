import { PgBoss } from 'pg-boss';
import { fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { QUEUES } from '@velocity/services';
import type { JobPayloads, JobQueue, QueueName, SendJobOptions, Services } from '@velocity/services';
import { jobFailures, queueDepth } from './metrics';
import type { Tx } from '@velocity/services';

/** pg-boss–backed durable queues inside Postgres (SPEC §5.1 ADR 1, §5.6). */
export class PgBossJobQueue implements JobQueue {
  constructor(private readonly boss: PgBoss) {}

  private options(opts: SendJobOptions = {}) {
    return {
      ...(opts.startAfterSeconds ? { startAfter: opts.startAfterSeconds } : {}),
      ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      ...(opts.retryLimit !== undefined ? { retryLimit: opts.retryLimit } : {}),
      ...(opts.retryDelaySeconds !== undefined ? { retryDelay: opts.retryDelaySeconds } : {}),
      ...(opts.retryBackoff !== undefined ? { retryBackoff: opts.retryBackoff } : {}),
    };
  }

  async send<Q extends QueueName>(queue: Q, data: JobPayloads[Q], opts: SendJobOptions = {}): Promise<string | null> {
    return this.boss.send(queue, data as object, this.options(opts));
  }

  async sendInTx<Q extends QueueName>(tx: Tx, queue: Q, data: JobPayloads[Q], opts: SendJobOptions = {}): Promise<string | null> {
    return this.boss.send(queue, data as object, { ...this.options(opts), db: fromDrizzle(tx, sql) });
  }
}

export async function startBoss(databaseUrl: string, logger: Logger): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss', application_name: 'velocity-jobs', max: 4 });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.start();
  for (const name of Object.values(QUEUES)) {
    if (!(await boss.getQueue(name))) {
      await boss.createQueue(name, {
        retryLimit: name === 'webhooks' ? 0 : 3, // webhooks schedule their own retries
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: name === 'importers' || name === 'github' ? 3600 : 900,
      });
    }
  }
  const repairQueue = {
    retryLimit: 8,
    retryDelay: 30,
    retryBackoff: true,
    deadLetter: 'import_reference_repair_deadletter',
    expireInSeconds: 3600,
    heartbeatSeconds: 120,
  } as const;
  // updateQueue is required because createQueue does not change options on existing deployments.
  await boss.updateQueue('import_reference_repair_deadletter', { retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 900 });
  await boss.updateQueue('import_reference_repairs', repairQueue);
  await boss.updateQueue('importer_deadletter', { retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 900 });
  await boss.updateQueue('importers', {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    deadLetter: 'importer_deadletter',
    expireInSeconds: 3600,
    heartbeatSeconds: 120,
  });
  return boss;
}

/** Register workers + cron schedules (SPEC §5.6). Only in `all`/`worker` roles. */
export async function startWorkers(boss: PgBoss, services: Services, logger: Logger, opts: { auditRetentionDays: number }): Promise<void> {
  const run = <Q extends QueueName>(queue: Q, handler: (data: JobPayloads[Q]) => Promise<void>) =>
    boss.work<JobPayloads[Q]>(queue, async (jobs) => {
      for (const job of jobs) {
        try {
          await handler(job.data);
        } catch (err) {
          jobFailures.inc({ queue });
          logger.error({ err, queue, jobId: job.id }, 'job failed');
          throw err;
        }
      }
    });

  await run('cycles', async (d) => {
    if (d.type === 'rotate_team') await services.cycles.rotateTeam(d.teamId);
    else {
      const res = await services.cycles.rotateAll();
      logger.info({ teams: res.length }, 'cycle rotation run');
    }
  });
  await run('webhooks', async (d) => services.webhooks.deliver(d.deliveryId));
  await run('github', async (d) => {
    if (d.type === 'process_event') await services.github.processEvent(d.eventRowId);
    else await services.github.runBackfill(d.installId);
  });
  await run('importers', async (d) => services.importer.runCommit(d));
  await boss.work<JobPayloads['importer_deadletter']>('importer_deadletter', { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await services.importer.failCommit(job.data, 'Import job exhausted retries or expired.');
  });
  await boss.work<JobPayloads['import_reference_repairs']>('import_reference_repairs', { batchSize: 1, heartbeatRefreshSeconds: 30 }, async (jobs) => {
    for (const job of jobs) {
      try {
        const data = job.data;
        if (data.type === 'scan') await services.importReferenceRepairs.scanJob(data.repairId, data.previewVersion);
        else await services.importReferenceRepairs.applyJob(data.repairId, data.previewHash);
      } catch (err) {
        jobFailures.inc({ queue: 'import_reference_repairs' });
        logger.error({ err, queue: 'import_reference_repairs', jobId: job.id }, 'job failed');
        throw err;
      }
    }
  });
  await boss.work<JobPayloads['import_reference_repair_deadletter']>('import_reference_repair_deadletter', { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      await services.importReferenceRepairs.failJob(job.data, 'Repair job exhausted retries or expired.');
    }
  });
  await run('exports', async (d) => services.exports.generate(d.exportId));
  await run('notifications', async () => {
    await services.events.drain();
  });
  await run('maintenance', async (d) => {
    if (d.type === 'daily') await services.maintenance.daily({ auditRetentionDays: opts.auditRetentionDays });
    else await services.events.drain();
  });

  // Hourly: each team rotates at its own local midnight, so an hourly sweep catches every timezone.
  await boss.schedule('cycles', '7 * * * *', { type: 'rotate_all' }, { tz: 'UTC' });
  await boss.schedule('maintenance', '17 3 * * *', { type: 'daily' }, { tz: 'UTC' });

  const depthTimer = setInterval(async () => {
    for (const q of Object.values(QUEUES)) {
      try {
        const info = await boss.getQueue(q);
        const count = (info as { queuedCount?: number } | null)?.queuedCount;
        if (typeof count === 'number') queueDepth.set({ queue: q }, count);
      } catch {
        /* metrics are best-effort */
      }
    }
  }, 15_000);
  depthTimer.unref();
}
