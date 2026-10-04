import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { QUEUES } from '@velocity/services';
import type { JobPayloads, JobQueue, QueueName, SendJobOptions, Services } from '@velocity/services';
import { jobFailures, queueDepth } from './metrics';

/** pg-boss–backed durable queues inside Postgres (SPEC §5.1 ADR 1, §5.6). */
export class PgBossJobQueue implements JobQueue {
  constructor(private readonly boss: PgBoss) {}

  async send<Q extends QueueName>(queue: Q, data: JobPayloads[Q], opts: SendJobOptions = {}): Promise<void> {
    await this.boss.send(queue, data as object, {
      ...(opts.startAfterSeconds ? { startAfter: opts.startAfterSeconds } : {}),
      ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      ...(opts.retryLimit !== undefined ? { retryLimit: opts.retryLimit } : {}),
      ...(opts.retryDelaySeconds !== undefined ? { retryDelay: opts.retryDelaySeconds } : {}),
      ...(opts.retryBackoff !== undefined ? { retryBackoff: opts.retryBackoff } : {}),
    });
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
  await run('importers', async (d) => services.importer.runCommit(d.runId));
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
