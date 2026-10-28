import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import pino from 'pino';
import { createDb } from '@velocity/services';
import { createHarness } from '../../../packages/services/test/helpers/harness.js';
import { PgBossJobQueue, startBoss } from '../src/jobs.js';

describe('pg-boss repair queue integration', () => {
  it('updates existing queue options and commits or rolls back Drizzle transaction enqueues', async () => {
    const harness = await createHarness();
    const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://velocity:velocity@localhost:54320/postgres');
    url.pathname = `/${harness.dbName}`;
    let boss: Awaited<ReturnType<typeof startBoss>> | undefined;

    try {
      // Model an upgrade from a deployment that already has the queue with old options.
      const previousBoss = new PgBoss({
        connectionString: url.toString(),
        schema: 'pgboss',
        application_name: 'velocity-jobs-test-seed',
        max: 2,
      });
      await previousBoss.start();
      try {
        await previousBoss.createQueue('import_reference_repairs', {
          retryLimit: 1,
          retryDelay: 1,
          expireInSeconds: 60,
        });
      } finally {
        await previousBoss.stop();
      }

      boss = await startBoss(url.toString(), pino({ level: 'silent' }));
      const queue = new PgBossJobQueue(boss);
      const repairId = randomUUID();

      await expect(
        createDb(harness.pool).transaction(async (tx) => {
          const jobId = await queue.sendInTx(tx, 'import_reference_repairs', {
            type: 'scan',
            repairId,
            previewVersion: 1,
          });
          expect(jobId).toBeTruthy();
          throw new Error('force enqueue rollback');
        }),
      ).rejects.toThrow('force enqueue rollback');

      const rolledBack = await harness.pool.query(
        `select id from pgboss.job where name = $1 and data->>'repairId' = $2`,
        ['import_reference_repairs', repairId],
      );
      expect(rolledBack.rows).toHaveLength(0);

      const committedId = await queue.send('import_reference_repairs', {
        type: 'scan',
        repairId,
        previewVersion: 2,
        });
      expect(committedId).toBeTruthy();

      const committed = await harness.pool.query(
        `select id, data from pgboss.job where id = $1 and name = $2`,
        [committedId, 'import_reference_repairs'],
      );
      expect(committed.rows).toHaveLength(1);
      expect(committed.rows[0].data).toMatchObject({ type: 'scan', repairId, previewVersion: 2 });

      const repairOptions = await boss.getQueue('import_reference_repairs');
      expect(repairOptions).toMatchObject({
        retryLimit: 8,
        deadLetter: 'import_reference_repair_deadletter',
        expireInSeconds: 3600,
        heartbeatSeconds: 120,
        });
      expect(await boss.getQueue('import_reference_repair_deadletter')).toBeTruthy();
    } finally {
      if (boss) await boss.stop();
      await harness.close();
    }
  });
});
