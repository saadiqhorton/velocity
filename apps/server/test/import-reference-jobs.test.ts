import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import pino from 'pino';
import { createDb } from '@velocity/services';
import { createHarness, setupOwner } from '../../../packages/services/test/helpers/harness.js';
import { PgBossJobQueue, startBoss, startWorkers } from '../src/jobs.js';

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
        await previousBoss.createQueue('importers', { retryLimit: 1, retryDelay: 1, retryBackoff: false, expireInSeconds: 60 });
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
      expect(await boss.getQueue('importers')).toMatchObject({
        retryLimit: 5,
        deadLetter: 'importer_deadletter',
        expireInSeconds: 3600,
        heartbeatSeconds: 120,
      });
      expect(await boss.getQueue('importer_deadletter')).toBeTruthy();
      expect(await boss.getQueue('import_reference_repair_deadletter')).toBeTruthy();
    } finally {
      if (boss) await boss.stop();
      await harness.close();
    }
  });

  it('uses real retry exhaustion and DLQ workers to finalize import and repair lifecycles idempotently', async () => {
    const harness = await createHarness();
    const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://velocity:velocity@localhost:54320/postgres');
    url.pathname = `/${harness.dbName}`;
    let boss: Awaited<ReturnType<typeof startBoss>> | undefined;
    const runCommit = vi.spyOn(harness.services.importer, 'runCommit').mockRejectedValue(new Error('injected importer crash'));
    const scanJob = vi.spyOn(harness.services.importReferenceRepairs, 'scanJob').mockRejectedValue(new Error('injected repair crash'));

    const waitFor = async (check: () => Promise<boolean>) => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Timed out waiting for real pg-boss DLQ delivery');
    };

    try {
      boss = await startBoss(url.toString(), pino({ level: 'silent' }));
      await startWorkers(boss, harness.services, pino({ level: 'silent' }), { auditRetentionDays: 90 });
      const owner = await setupOwner(harness, 'pgboss-owner');
      const run = await harness.services.importer.createRun(owner, {
        source: 'linear',
        bundle: {
          source: 'linear', teams: [], statuses: [], users: [], labels: [], projects: [], cycles: [], warnings: [], issues: [],
        },
      });
      await harness.services.importer.dryRun(owner, run.id);
      await harness.services.importer.commit(owner, run.id);
      const importJob = harness.jobs.sent.filter((job) => job.queue === 'importers').at(-1)!.data as {
        type: 'commit'; runId: string; commitId: string; commitHash: string;
      };
      const sourceId = await boss.send('importers', importJob, { retryLimit: 1, retryDelay: 1, retryBackoff: false });
      expect(sourceId).toBeTruthy();
      await waitFor(async () => (await harness.services.importer.get(owner, run.id))?.status === 'failed');
      expect(runCommit).toHaveBeenCalledTimes(2);
      const importedDlq = await harness.pool.query(`select id from pgboss.job where name = 'importer_deadletter' and data->>'runId' = $1`, [run.id]);
      expect(importedDlq.rows.length).toBeGreaterThan(0);

      const resumed = await harness.services.importer.commit(owner, run.id);
      expect(resumed.commitId).not.toBe(importJob.commitId);
      const duplicateImporterDlqId = await boss.send('importer_deadletter', importJob);
      expect(duplicateImporterDlqId).toBeTruthy();
      await waitFor(async () => {
        const result = await harness.pool.query(`select state from pgboss.job where id = $1`, [duplicateImporterDlqId]);
        return result.rows[0]?.state === 'completed';
      });
      expect((await harness.services.importer.get(owner, run.id))?.commitId).toBe(resumed.commitId);

      const successfulRun = await harness.services.importer.createRun(owner, {
        source: 'linear',
        bundle: {
          source: 'linear', teams: [], statuses: [], users: [], labels: [], projects: [], cycles: [], warnings: [], issues: [],
        },
      });
      await harness.services.importer.dryRun(owner, successfulRun.id);
      await harness.services.importer.commit(owner, successfulRun.id);
      runCommit.mockRestore();
      const successfulJob = harness.jobs.sent.filter((job) => job.queue === 'importers').at(-1)!.data as {
        type: 'commit'; runId: string; commitId: string; commitHash: string;
      };
      const retryId = await boss.send('importers', successfulJob, { retryLimit: 0 });
      expect(retryId).toBeTruthy();
      await waitFor(async () => (await harness.services.importer.get(owner, successfulRun.id))?.status === 'completed');

      const repair = await harness.services.importReferenceRepairs.startScan(owner, successfulRun.id);
      const repairJob = { type: 'scan' as const, repairId: repair.id, previewVersion: repair.previewVersion };
      const repairSourceId = await boss.send('import_reference_repairs', repairJob, { retryLimit: 1, retryDelay: 1, retryBackoff: false });
      expect(repairSourceId).toBeTruthy();
      await waitFor(async () => (await harness.services.importReferenceRepairs.get(owner, repair.id))?.status === 'failed');
      expect(scanJob).toHaveBeenCalledTimes(2);
      const repairDlq = await harness.pool.query(`select id from pgboss.job where name = 'import_reference_repair_deadletter' and data->>'repairId' = $1`, [repair.id]);
      expect(repairDlq.rows.length).toBeGreaterThan(0);

      const newerRepair = await harness.services.importReferenceRepairs.startScan(owner, successfulRun.id);
      expect(newerRepair.id).not.toBe(repair.id);
      const duplicateRepairDlqId = await boss.send('import_reference_repair_deadletter', repairJob);
      expect(duplicateRepairDlqId).toBeTruthy();
      await waitFor(async () => {
        const result = await harness.pool.query(`select state from pgboss.job where id = $1`, [duplicateRepairDlqId]);
        return result.rows[0]?.state === 'completed';
      });
      expect((await harness.services.importReferenceRepairs.get(owner, newerRepair.id))?.status).toBe('scanning');
    } finally {
      runCommit.mockRestore();
      scanJob.mockRestore();
      if (boss) await boss.stop();
      await harness.close();
    }
  }, 60_000);
});
