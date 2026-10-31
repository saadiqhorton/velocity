import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { ImportBundle, ImportMapping } from '@velocity/schema';
import type { Harness } from '../helpers/harness';
import { addMember, createHarness, setupOwner } from '../helpers/harness';
import type { ServiceActor } from '../../src/index';
import type { PoolClient } from 'pg';

async function waitUntilMoveBlocksOn(h: Harness, blockerPid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const blocked = await h.pool.query<{ pid: number }>(`
      select pid from pg_stat_activity
       where $1::int = any(pg_blocking_pids(pid))
         and query ilike '%from "issues"%'
         and query ilike '%for update%'
    `, [blockerPid]);
    if (blocked.rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Issue move did not block on PostgreSQL backend ${blockerPid}.`);
}

async function captureApplyQueryCounts<T>(h: Harness, action: () => Promise<T>): Promise<{
  value: T;
  mappingScans: number;
  provenanceLookups: number;
  issueLocks: number;
  commentLocks: number;
  teamLocks: number;
  contentCasWrites: number;
  lockOrder: string[];
}> {
  let mappingScans = 0;
  let provenanceLookups = 0;
  let issueLocks = 0;
  let commentLocks = 0;
  let teamLocks = 0;
  let contentCasWrites = 0;
  const lockOrder: string[] = [];
  const originals = new Map<PoolClient, PoolClient['query']>();
  const onAcquire = (client: PoolClient) => {
    if (originals.has(client)) return;
    const original = client.query;
    originals.set(client, original);
    client.query = new Proxy(original, {
      apply(target, thisArg, args: unknown[]) {
        const queryArg = args[0];
        const queryText = typeof queryArg === 'string'
          ? queryArg
          : queryArg !== null && typeof queryArg === 'object' && 'text' in queryArg && typeof queryArg.text === 'string'
            ? queryArg.text
            : '';
        const lower = queryText.toLowerCase();
        const whereAt = lower.indexOf(' where ');
        const predicate = whereAt < 0 ? '' : lower.slice(whereAt + 7);
        if (/from\s+"import_items"/i.test(queryText)
          && /"import_items"\."run_id"\s*=\s*\$\d+/i.test(predicate)
          && /"import_items"\."kind"\s*=\s*\$\d+/i.test(predicate)) {
          if (/"import_items"\."external_id"\s*=\s*\$\d+/i.test(predicate)) provenanceLookups++;
          else mappingScans++;
        }
        if (/from\s+"issues"/i.test(queryText) && /for\s+update/i.test(lower)) { issueLocks++; lockOrder.push('issues'); }
        if (/from\s+"comments"/i.test(queryText) && /for\s+update/i.test(lower)) { commentLocks++; lockOrder.push('comments'); }
        if (/from\s+"teams"/i.test(queryText) && /for\s+share/i.test(lower)) { teamLocks++; lockOrder.push('teams'); }
        if (/update\s+"(?:issues|comments)"\s+set/i.test(queryText)
          && /"(?:description_md|body_md)"\s*=\s*\$\d+/i.test(lower)
          && /where[\s\S]*?"(?:description_md|body_md)"\s*=\s*\$\d+/i.test(lower)) contentCasWrites++;
        return Reflect.apply(target, thisArg, args);
      },
    }) as PoolClient['query'];
  };
  h.pool.on('acquire', onAcquire);
  try {
    const value = await action();
    return { value, mappingScans, provenanceLookups, issueLocks, commentLocks, teamLocks, contentCasWrites, lockOrder };
  } finally {
    h.pool.off('acquire', onAcquire);
    for (const [client, query] of originals) client.query = query;
  }
}
describe('historical import reference repair', () => {
  let h: Harness;
  let owner: ServiceActor;
  let member: ServiceActor;
  let runId: string;

  beforeAll(async () => {
    h = await createHarness();
    owner = await setupOwner(h);
    member = await addMember(h, owner, 'repair-member');
    const bundle: ImportBundle = {
      source: 'linear',
      teams: [{ externalId: 'team', key: 'ENG', name: 'Engineering' }],
      statuses: [{ teamExternalId: 'team', name: 'Todo', category: 'todo' }],
      users: [], labels: [], projects: [], cycles: [], warnings: [],
      issues: [
        { externalId: 'ENG-1', teamExternalId: 'team', title: 'One', descriptionMd: 'ENG-2 and `ENG-2` OUT-99', statusName: 'Todo', labelNames: [], relations: [], comments: [{ bodyMd: 'ENG-2 and `ENG-1`', authorName: 'Author' }], attachments: [] },
        { externalId: 'ENG-2', teamExternalId: 'team', title: 'Two', descriptionMd: 'ENG-1', statusName: 'Todo', labelNames: [], relations: [], comments: [], attachments: [] },
      ],
    };
    const run = await h.services.importer.createRun(owner, { source: 'linear', bundle });
    runId = run.id;
    const mapping = run.mapping as ImportMapping;
    await h.services.importer.updateMapping(owner, run.id, {
      ...mapping,
      teams: Object.fromEntries(Object.entries(mapping.teams).map(([key, target]) => [key, target.mode === 'create' ? { ...target, key: 'VEL' } : target])),
    });
    await h.services.importer.dryRun(owner, run.id);
    await h.services.importer.commit(owner, run.id);
    await h.services.importer.runCommit(run.id);
    // Recreate an older import whose prose still contains source keys, for repair coverage.
    const imported = await h.pool.query<{ external_id: string; entity_id: string }>(
      `select external_id, entity_id from import_items where run_id = $1 and kind = 'issue'`, [run.id],
    );
    for (const row of imported.rows) {
      const body = row.external_id === 'ENG-1' ? 'ENG-2 and `ENG-2` OUT-99' : 'ENG-1';
      await h.pool.query('update issues set description_md = $1 where id = $2', [body, row.entity_id]);
    }
    await h.pool.query('update comments set body_md = $1 where issue_id = (select entity_id from import_items where run_id = $2 and kind = $3 and external_id = $4)', ['ENG-2 and `ENG-1`', run.id, 'issue', 'ENG-1']);
  });

  afterAll(async () => h.close());

  async function restoreSourceText(): Promise<void> {
    const rows = await h.pool.query<{ external_id: string; entity_id: string }>(
      `select external_id, entity_id from import_items where run_id = $1 and kind = 'issue'`, [runId],
    );
    for (const row of rows.rows) {
      const body = row.external_id === 'ENG-1' ? 'ENG-2 and `ENG-2` OUT-99' : 'ENG-1';
      await h.pool.query('update issues set description_md = $1 where id = $2', [body, row.entity_id]);
    }
    await h.pool.query('update comments set body_md = $1 where issue_id = (select entity_id from import_items where run_id = $2 and kind = $3 and external_id = $4)', ['ENG-2 and `ENG-1`', runId, 'issue', 'ENG-1']);
  }

  it('persists a preview, rejects stale/unconfirmed applies, skips edited targets and is retry safe', async () => {
    const service = h.services.importReferenceRepairs;
    await expect(service.startScan(member, runId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const started = await service.startScan(owner, runId);
    expect(h.jobs.sent).toContainEqual(expect.objectContaining({ queue: 'import_reference_repairs', data: { type: 'scan', repairId: started.id, previewVersion: 1 } }));
    await expect(service.get(member, started.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await service.scanJob(started.id, started.previewVersion);
    const preview = await service.get(owner, started.id);
    expect(preview?.status).toBe('preview');
    expect(preview?.previewHash).toMatch(/^[0-9a-f]{64}$/);
    expect(preview?.summary).toMatchObject({ targets: 3, references: 3, unmapped: 1, codeSkipped: 2 });
    expect(preview?.targets).toHaveLength(3);
    await expect(service.apply(owner, started.id, 'wrong-preview-hash', true)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(service.apply(owner, started.id, preview!.previewHash, false)).rejects.toMatchObject({ code: 'VALIDATION' });

    const target = preview!.targets.find((t) => t.targetKind === 'issue_description' && t.sourceExternalId === 'ENG-1')!;
    await h.pool.query('update issues set description_md = $1 where id = $2', ['User edited after preview', target.targetId]);
    expect((await h.pool.query('select description_md from issues where id = $1', [target.targetId])).rows[0].description_md).toBe('User edited after preview');
    await service.apply(owner, started.id, preview!.previewHash, true);
    expect(h.jobs.sent).toContainEqual(expect.objectContaining({ queue: 'import_reference_repairs', data: { type: 'apply', repairId: started.id, previewHash: preview!.previewHash } }));
    await Promise.all([service.applyJob(started.id, preview!.previewHash), service.applyJob(started.id, preview!.previewHash)]);
    const result = await service.get(owner, started.id);
    expect(result?.status).toBe('completed');
    expect(result?.summary).toMatchObject({ applied: 2, skipped: 1, stale: 1 });
    const marker = await h.pool.query(`select count(*)::int as n from import_items where run_id = $1 and kind = 'reference_repair_complete' and external_id = $2`, [runId, started.id]);
    expect(marker.rows[0].n).toBe(1);
    const activeCount = await h.pool.query(`select count(*)::int as n from import_reference_repairs where run_id = $1 and status in ('scanning','preview','applying')`, [runId]);
    expect(activeCount.rows[0].n).toBe(0);
  });

  it('allows a rescan to replace the previous preview with a new version', async () => {
    const service = h.services.importReferenceRepairs;
    const first = await service.startScan(owner, runId);
    await service.scanJob(first.id, first.previewVersion);
    const prior = await service.get(owner, first.id);
    const next = await service.startScan(owner, runId);
    expect(next.previewVersion).toBe(prior!.previewVersion + 1);
    expect((await service.get(owner, first.id))?.status).toBe('superseded');
    await service.scanJob(next.id, next.previewVersion);
    expect((await service.get(owner, next.id))?.status).toBe('preview');
  });

  it('rolls back scan supersession, apply state, and audit when enqueue rejects or returns null', async () => {
    const service = h.services.importReferenceRepairs;
    const prior = await service.startScan(owner, runId);
    await service.scanJob(prior.id, prior.previewVersion);
    const repairCount = Number((await h.pool.query('select count(*)::int as n from import_reference_repairs where run_id = $1', [runId])).rows[0].n);
    const auditCount = Number((await h.pool.query(`select count(*)::int as n from audit_log where action in ('import.reference_repair.scan','import.reference_repair.apply')`)).rows[0].n);

    for (const failure of [new Error('queue unavailable'), 'null'] as const) {
      h.jobs.nextSendFailure = failure;
      await expect(service.startScan(owner, runId)).rejects.toThrow();
      expect((await service.get(owner, prior.id))?.status).toBe('preview');
      expect(Number((await h.pool.query('select count(*)::int as n from import_reference_repairs where run_id = $1', [runId])).rows[0].n)).toBe(repairCount);
      expect(Number((await h.pool.query(`select count(*)::int as n from audit_log where action in ('import.reference_repair.scan','import.reference_repair.apply')`)).rows[0].n)).toBe(auditCount);
    }

    for (const failure of [new Error('queue unavailable'), 'null'] as const) {
      h.jobs.nextSendFailure = failure;
      await expect(service.apply(owner, prior.id, (await service.get(owner, prior.id))!.previewHash, true)).rejects.toThrow();
      expect((await service.get(owner, prior.id))?.status).toBe('preview');
      expect(Number((await h.pool.query(`select count(*)::int as n from audit_log where action in ('import.reference_repair.scan','import.reference_repair.apply')`)).rows[0].n)).toBe(auditCount);
    }
  });

  it('serializes duplicate scan deliveries and duplicate finalizers', async () => {
    await restoreSourceText();
    const service = h.services.importReferenceRepairs;
    const scan = await service.startScan(owner, runId);
    await Promise.all([service.scanJob(scan.id, scan.previewVersion), service.scanJob(scan.id, scan.previewVersion)]);
    const preview = await service.get(owner, scan.id);
    expect(preview?.status).toBe('preview');
    expect(preview?.targets).toHaveLength(3);
    await service.apply(owner, scan.id, preview!.previewHash, true);
    await Promise.all([service.applyJob(scan.id, preview!.previewHash), service.applyJob(scan.id, preview!.previewHash)]);
    const completed = await service.get(owner, scan.id);
    expect(completed?.status).toBe('completed');
    const markers = await h.pool.query(`select count(*)::int as n from import_items where run_id = $1 and kind = 'reference_repair_complete' and external_id = $2`, [runId, scan.id]);
    expect(markers.rows[0].n).toBe(1);
  });

  it('marks exhausted jobs failed only for the matching preview generation', async () => {
    const service = h.services.importReferenceRepairs;
    const scan = await service.startScan(owner, runId);
    await service.failJob({ type: 'scan', repairId: scan.id, previewVersion: scan.previewVersion + 1 }, 'stale delivery');
    expect((await service.get(owner, scan.id))?.status).toBe('scanning');
    await service.failJob({ type: 'scan', repairId: scan.id, previewVersion: scan.previewVersion }, 'scan retries exhausted');
    await service.failJob({ type: 'scan', repairId: scan.id, previewVersion: scan.previewVersion }, 'duplicate dead-letter delivery');
    expect((await service.get(owner, scan.id))?.status).toBe('failed');
    expect((await service.get(owner, scan.id))?.error).toBe('scan retries exhausted');

    const retry = await service.startScan(owner, runId);
    await service.scanJob(retry.id, retry.previewVersion);
    const preview = await service.get(owner, retry.id);
    await service.apply(owner, retry.id, preview!.previewHash, true);
    await service.failJob({ type: 'apply', repairId: retry.id, previewHash: 'wrong-hash' }, 'stale delivery');
    expect((await service.get(owner, retry.id))?.status).toBe('applying');
    await service.failJob({ type: 'apply', repairId: retry.id, previewHash: preview!.previewHash }, 'apply retries exhausted');
    await service.failJob({ type: 'apply', repairId: retry.id, previewHash: preview!.previewHash }, 'duplicate dead-letter delivery');
    expect((await service.get(owner, retry.id))?.status).toBe('failed');
    expect((await service.get(owner, retry.id))?.error).toBe('apply retries exhausted');
    expect(Number((await h.pool.query(`select count(*)::int as n from import_items where run_id = $1 and kind = 'reference_repair_complete' and external_id = $2`, [runId, retry.id])).rows[0].n)).toBe(0);
  });

  it('uses a compare-and-set write when an editor changes content during apply', async () => {
    await restoreSourceText();
    const service = h.services.importReferenceRepairs;
    const scan = await service.startScan(owner, runId);
    await service.scanJob(scan.id, scan.previewVersion);
    const preview = await service.get(owner, scan.id);
    const target = preview!.targets.find((row) => row.targetKind === 'issue_description' && row.sourceExternalId === 'ENG-1')!;
    await service.apply(owner, scan.id, preview!.previewHash, true);

    let signalReached!: () => void;
    let releaseWrite!: () => void;
    const reached = new Promise<void>((resolve) => { signalReached = resolve; });
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    service.beforeApplyContentWrite = async (current) => {
      if (current.id !== target.id) return;
      service.beforeApplyContentWrite = null;
      signalReached();
      await gate;
    };
    const applying = service.applyJob(scan.id, preview!.previewHash);
    await reached;
    await h.pool.query('update issues set description_md = $1 where id = $2', ['Concurrent editor text', target.targetId]);
    releaseWrite();
    await applying;
    const result = await service.get(owner, scan.id);
    expect(result?.targets.find((row) => row.id === target.id)).toMatchObject({ status: 'skipped', skipReason: 'stale' });
    expect(result?.summary).toMatchObject({ stale: 1 });
    const text = await h.pool.query('select description_md from issues where id = $1', [target.targetId]);
    expect(text.rows[0].description_md).toBe('Concurrent editor text');
  });

  it('re-resolves destination identifiers after a team rename and issue move', async () => {
    await restoreSourceText();
    const service = h.services.importReferenceRepairs;
    const scan = await service.startScan(owner, runId);
    await service.scanJob(scan.id, scan.previewVersion);
    const preview = await service.get(owner, scan.id);
    await h.pool.query(`update teams set key = 'REN' where id = (select i.team_id from issues i join import_items it on it.entity_id = i.id where it.run_id = $1 and it.kind = 'issue' and it.external_id = 'ENG-1')`, [runId]);
    expect((await h.pool.query(`select t.key from teams t join issues i on i.team_id = t.id join import_items it on it.entity_id = i.id where it.run_id = $1 and it.kind = 'issue' and it.external_id = 'ENG-1'`, [runId])).rows[0].key).toBe('REN');
    await service.apply(owner, scan.id, preview!.previewHash, true);
    await service.applyJob(scan.id, preview!.previewHash);
    const renamedResult = await service.get(owner, scan.id);
    expect(renamedResult?.summary).toMatchObject({ stale: 3, applied: 0 });
    await h.pool.query(`update teams set key = 'VEL' where key = 'REN'`);

    await restoreSourceText();
    const moveScan = await service.startScan(owner, runId);
    await service.scanJob(moveScan.id, moveScan.previewVersion);
    const movePreview = await service.get(owner, moveScan.id);
    const targetIssue = await h.pool.query<{ team_id: string }>(`select i.team_id from issues i join import_items it on it.entity_id = i.id where it.run_id = $1 and it.kind = 'issue' and it.external_id = 'ENG-2'`, [runId]);
    const originalTeamId = targetIssue.rows[0]!.team_id;
    const movedTeam = await h.services.teams.create(owner, { key: 'MOVED', name: 'Moved destination' });
    await h.pool.query('update issues set team_id = $1 where id = (select entity_id from import_items where run_id = $2 and kind = $3 and external_id = $4)', [movedTeam.id, runId, 'issue', 'ENG-2']);
    await service.apply(owner, moveScan.id, movePreview!.previewHash, true);
    await service.applyJob(moveScan.id, movePreview!.previewHash);
    expect((await service.get(owner, moveScan.id))?.summary).toMatchObject({ stale: 2, applied: 1 });
    await h.pool.query('update issues set team_id = $1 where id = (select entity_id from import_items where run_id = $2 and kind = $3 and external_id = $4)', [originalTeamId, runId, 'issue', 'ENG-2']);
  });

  it('classifies a deleted comment target as missing and never recreates it', async () => {
    await restoreSourceText();
    const service = h.services.importReferenceRepairs;
    const scan = await service.startScan(owner, runId);
    await service.scanJob(scan.id, scan.previewVersion);
    const preview = await service.get(owner, scan.id);
    const target = preview!.targets.find((row) => row.targetKind === 'comment_body')!;
    await h.pool.query('delete from comments where id = $1', [target.targetId]);
    await service.apply(owner, scan.id, preview!.previewHash, true);
    await service.applyJob(scan.id, preview!.previewHash);
    expect((await service.get(owner, scan.id))?.targets.find((row) => row.id === target.id)).toMatchObject({ status: 'skipped', skipReason: 'missing' });
    expect(Number((await h.pool.query('select count(*)::int as n from comments where id = $1', [target.targetId])).rows[0].n)).toBe(0);
    expect((await service.get(owner, scan.id))?.summary).toMatchObject({ missing: 1, skipped: 1 });
  });

  it('applies a self-referencing comment while a normal issue move waits on the issue family', async () => {
    const bundle: ImportBundle = {
      source: 'linear',
      teams: [{ externalId: 'repair-lock', key: 'LOCK', name: 'Lock order' }],
      statuses: [{ teamExternalId: 'repair-lock', name: 'Todo', category: 'todo' }],
      users: [], labels: [], projects: [], cycles: [], warnings: [],
      issues: [
        {
          externalId: 'LOCK-1', teamExternalId: 'repair-lock', title: 'Moved issue', descriptionMd: 'No references',
          statusName: 'Todo', labelNames: [], relations: [], attachments: [],
          comments: [{ bodyMd: 'See LOCK-1', authorName: 'Author' }],
        },
        {
          externalId: 'LOCK-2', teamExternalId: 'repair-lock', title: 'Referenced issue', descriptionMd: 'See LOCK-1',
          statusName: 'Todo', labelNames: [], relations: [], comments: [], attachments: [],
        },
      ],
    };
    const run = await h.services.importer.createRun(owner, { source: 'linear', bundle });
    const mapping = run.mapping as ImportMapping;
    await h.services.importer.updateMapping(owner, run.id, {
      ...mapping,
      teams: { 'repair-lock': { mode: 'create', key: 'RPRX', name: 'Repair lock destination' } },
    });
    await h.services.importer.dryRun(owner, run.id);
    await h.services.importer.commit(owner, run.id);
    await h.services.importer.runCommit(run.id);

    const imported = await h.pool.query<{ external_id: string; entity_id: string; identifier: string }>(`
      select it.external_id, it.entity_id, t.key || '-' || i.number as identifier
        from import_items it join issues i on i.id = it.entity_id join teams t on t.id = i.team_id
       where it.run_id = $1 and it.kind = 'issue' order by it.external_id
    `, [run.id]);
    const movedSource = imported.rows.find((row) => row.external_id === 'LOCK-1')!;
    const referenced = imported.rows.find((row) => row.external_id === 'LOCK-2')!;
    const comment = await h.pool.query<{ id: string }>(`
      select id from comments where issue_id = $1
    `, [movedSource.entity_id]);
    const commentId = comment.rows[0]!.id;
    await h.pool.query('update issues set description_md = $1 where id = $2', ['No references', movedSource.entity_id]);
    await h.pool.query('update issues set description_md = $1 where id = $2', ['See LOCK-1', referenced.entity_id]);
    await h.pool.query('update comments set body_md = $1 where id = $2', ['See LOCK-1', commentId]);

    const service = h.services.importReferenceRepairs;
    const scan = await service.startScan(owner, run.id);
    await service.scanJob(scan.id, scan.previewVersion);
    const preview = await service.get(owner, scan.id);
    expect(preview?.summary).toMatchObject({ targets: 2, references: 2 });
    expect(preview?.targets.map((target) => target.targetKind).sort()).toEqual(['comment_body', 'issue_description']);
    await service.apply(owner, scan.id, preview!.previewHash, true);

    const moveTeam = await h.services.teams.create(owner, { key: 'MOVEL', name: 'Move lock destination' });
    let applyPid = 0;
    let reached!: () => void;
    let releaseApply!: () => void;
    const atCommentLock = new Promise<void>((resolve) => { reached = resolve; });
    const applyGate = new Promise<void>((resolve) => { releaseApply = resolve; });
    service.beforeApplyComments = async (tx, commentIds) => {
      if (!commentIds.includes(commentId)) return;
      const result = await tx.execute(sql`select pg_backend_pid() as pid`) as unknown as { rows: { pid: number }[] };
      applyPid = Number(result.rows[0]!.pid);
      reached();
      await applyGate;
    };

    const applying = service.applyJob(scan.id, preview!.previewHash);
    await atCommentLock;
    const moving = h.services.issues.move(owner, movedSource.entity_id, moveTeam.id);
    await waitUntilMoveBlocksOn(h, applyPid);
    releaseApply();
    await Promise.all([applying, moving]);
    service.beforeApplyComments = null;

    expect((await service.get(owner, scan.id))?.status).toBe('completed');
    const oldIssue = await h.pool.query<{ moved_to_issue_id: string | null }>(
      'select moved_to_issue_id from issues where id = $1', [movedSource.entity_id],
    );
    const newIssueId = oldIssue.rows[0]!.moved_to_issue_id!;
    const finalIssue = await h.pool.query<{ team_id: string; description_md: string }>(
      'select team_id, description_md from issues where id = $1', [newIssueId],
    );
    const finalComment = await h.pool.query<{ issue_id: string; body_md: string }>(
      'select issue_id, body_md from comments where id = $1', [commentId],
    );
    const referencedAfter = await h.pool.query<{ description_md: string }>(
      'select description_md from issues where id = $1', [referenced.entity_id],
    );
    expect(finalIssue.rows[0]).toMatchObject({ team_id: moveTeam.id, description_md: 'No references' });
    expect(finalComment.rows[0]).toEqual({ issue_id: newIssueId, body_md: `See ${movedSource.identifier}` });
    expect(referencedAfter.rows[0]!.description_md).toBe(`See ${movedSource.identifier}`);
  });

  it('bounds large applies and leaves the repair applying until continuation outcomes finish', async () => {
    const issues = Array.from({ length: 101 }, (_, index) => {
      const number = index + 1;
      const next = number === 101 ? 1 : number + 1;
      return {
        externalId: 'BUL-' + number, teamExternalId: 'bulk', title: 'Bulk ' + number, descriptionMd: number === 1 ? 'See BUL-' + next + String.fromCharCode(10) + String.fromCharCode(96).repeat(3) + 'typescript' + String.fromCharCode(10) + 'BUL-3' : 'See BUL-' + next,
        statusName: 'Todo', labelNames: [], relations: [], comments: [], attachments: [],
      };
    });
    const bundle: ImportBundle = {
      source: 'linear', teams: [{ externalId: 'bulk', key: 'BUL', name: 'Bulk' }],
      statuses: [{ teamExternalId: 'bulk', name: 'Todo', category: 'todo' }], users: [], labels: [], projects: [], cycles: [], warnings: [], issues,
    };
    const run = await h.services.importer.createRun(owner, { source: 'linear', bundle });
    const mapping = run.mapping as ImportMapping;
    await h.services.importer.updateMapping(owner, run.id, { ...mapping, teams: { bulk: { mode: 'create', key: 'BULX', name: 'Bulk destination' } } });
    await h.services.importer.dryRun(owner, run.id);
    await h.services.importer.commit(owner, run.id);
    await h.services.importer.runCommit(run.id);
    const imported = await h.pool.query<{ external_id: string; entity_id: string }>(`select external_id, entity_id from import_items where run_id = $1 and kind = 'issue' order by external_id`, [run.id]);
    for (const row of imported.rows) {
      const number = Number(row.external_id.split('-')[1]);
      const next = number === 101 ? 1 : number + 1;
      const body = number === 1 ? 'See BUL-' + next + String.fromCharCode(10) + String.fromCharCode(96).repeat(3) + 'typescript' + String.fromCharCode(10) + 'BUL-3' : 'See BUL-' + next;
      await h.pool.query('update issues set description_md = $1 where id = $2', [body, row.entity_id]);
    }
    const repair = await h.services.importReferenceRepairs.startScan(owner, run.id);
    await h.services.importReferenceRepairs.scanJob(repair.id, repair.previewVersion);
    const preview = await h.services.importReferenceRepairs.get(owner, repair.id, { first: 1 });
    expect(preview?.summary).toMatchObject({ targets: 101, references: 101 });
    await h.pool.query('update import_reference_repair_targets set id = $1 where repair_id = $2 and target_id = (select entity_id from import_items where run_id = $3 and kind = $4 and external_id = $5)', ['00000000-0000-0000-0000-000000000001', repair.id, run.id, 'issue', 'BUL-1']);
    await h.services.importReferenceRepairs.apply(owner, repair.id, preview!.previewHash, true);
    const firstBatch = await captureApplyQueryCounts(h, () => h.services.importReferenceRepairs.applyJob(repair.id, preview!.previewHash));
    expect(firstBatch).toMatchObject({
      mappingScans: 1, provenanceLookups: 100, issueLocks: 1, commentLocks: 0, teamLocks: 1, contentCasWrites: 100,
    });
    expect(firstBatch.lockOrder).toEqual(['issues', 'teams']);
    expect((await h.services.importReferenceRepairs.get(owner, repair.id))?.status).toBe('applying');
    expect(Number((await h.pool.query(`select count(*)::int as n from import_reference_repair_targets where repair_id = $1 and status = 'pending'`, [repair.id])).rows[0].n)).toBe(1);
    expect(h.jobs.sent.filter((job) => job.queue === 'import_reference_repairs' && (job.data as { type?: string }).type === 'apply').length).toBeGreaterThanOrEqual(2);
    const secondBatch = await captureApplyQueryCounts(h, () => h.services.importReferenceRepairs.applyJob(repair.id, preview!.previewHash));
    expect(secondBatch).toMatchObject({ mappingScans: 1, provenanceLookups: 1, issueLocks: 1, commentLocks: 0, teamLocks: 1, contentCasWrites: 1 });
    expect(secondBatch.lockOrder).toEqual(['issues', 'teams']);
    const result = await h.services.importReferenceRepairs.get(owner, repair.id);
    expect(result?.status).toBe('completed');
    expect(result?.summary).toMatchObject({ applied: 101, skipped: 0 });
  }, 120_000);

  it('scans duplicate source keys once while reporting ambiguous references', async () => {
    const issue = (title: string, descriptionMd: string) => ({
      externalId: 'DUP-1', teamExternalId: 'duplicate-team', title, descriptionMd, statusName: 'Todo',
      labelNames: [], relations: [], comments: [], attachments: [],
    });
    const bundle: ImportBundle = {
      source: 'linear', teams: [{ externalId: 'duplicate-team', key: 'DUP', name: 'Duplicates' }],
      statuses: [{ teamExternalId: 'duplicate-team', name: 'Todo', category: 'todo' }], users: [], labels: [], projects: [], cycles: [], warnings: [],
      issues: [
        issue('First duplicate', 'See DUP-2'),
        issue('Second duplicate', 'See DUP-2'),
        { ...issue('Unique issue', 'See DUP-1'), externalId: 'DUP-2', title: 'Unique issue' },
      ],
    };
    const run = await h.services.importer.createRun(owner, { source: 'linear', bundle });
    const mapping = run.mapping as ImportMapping;
    await h.services.importer.updateMapping(owner, run.id, { ...mapping, teams: { 'duplicate-team': { mode: 'create', key: 'DUPX', name: 'Duplicates' } } });
    await h.services.importer.dryRun(owner, run.id);
    await h.services.importer.commit(owner, run.id);
    await h.services.importer.runCommit(run.id);
    const imported = await h.pool.query<{ external_id: string; entity_id: string }>("select external_id, entity_id from import_items where run_id = $1 and kind = 'issue'", [run.id]);
    for (const row of imported.rows) {
      await h.pool.query('update issues set description_md = $1 where id = $2', [row.external_id === 'DUP-1' ? 'See DUP-2' : 'See DUP-1', row.entity_id]);
    }
    const repair = await h.services.importReferenceRepairs.startScan(owner, run.id);
    await h.services.importReferenceRepairs.scanJob(repair.id, repair.previewVersion);
    const preview = await h.services.importReferenceRepairs.get(owner, repair.id);
    expect(preview?.status).toBe('preview');
    expect(preview?.summary).toMatchObject({ targets: 1, references: 1, ambiguous: 1 });
    expect(preview?.targets).toHaveLength(1);
  });

  it('counts a missing persisted source mapping once and leaves its text untouched', async () => {
    const bundle: ImportBundle = {
      source: 'linear', teams: [{ externalId: 'missing-team', key: 'MISS', name: 'Missing map' }],
      statuses: [{ teamExternalId: 'missing-team', name: 'Todo', category: 'todo' }], users: [], labels: [], projects: [], cycles: [], warnings: [],
      issues: [
        { externalId: 'MISS-1', teamExternalId: 'missing-team', title: 'Mapped', descriptionMd: 'See MISS-2', statusName: 'Todo', labelNames: [], relations: [], comments: [], attachments: [] },
        { externalId: 'MISS-2', teamExternalId: 'missing-team', title: 'Missing mapping', descriptionMd: 'No refs', statusName: 'Todo', labelNames: [], relations: [], comments: [], attachments: [] },
      ],
    };
    const run = await h.services.importer.createRun(owner, { source: 'linear', bundle });
    await h.services.importer.dryRun(owner, run.id);
    await h.services.importer.commit(owner, run.id);
    await h.services.importer.runCommit(run.id);
    await h.pool.query("delete from import_items where run_id = $1 and kind = 'issue' and external_id = 'MISS-2'", [run.id]);
    const service = h.services.importReferenceRepairs;
    const repair = await service.startScan(owner, run.id);
    await service.scanJob(repair.id, repair.previewVersion);
    const preview = await service.get(owner, repair.id);
    expect(preview?.summary).toMatchObject({ missing: 1, targets: 0 });
    expect(preview?.summary.missing).toBe(1);
    const issue = await h.pool.query<{ description_md: string }>("select i.description_md from issues i join import_items it on it.entity_id = i.id where it.run_id = $1 and it.kind = 'issue' and it.external_id = 'MISS-1'", [run.id]);
    expect(issue.rows[0]?.description_md).toBe('See MISS-2');
  });

  it('repairs the historical split label and stale Linear destination form to zero on rescan', async () => {
    const stale = '[DEZ-72](https://linear.app/saadiqhorton/issue/SAA-77/spec-tool-catalog-auto-discovery-output-cap-phase-1)';
    const bundle: ImportBundle = {
      source: 'linear',
      teams: [{ externalId: 'linear-link', key: 'SAA', name: 'Linear links' }],
      statuses: [{ teamExternalId: 'linear-link', name: 'Todo', category: 'todo' }],
      users: [], labels: [], projects: [], cycles: [], warnings: [],
      issues: [
        { externalId: 'SAA-77', teamExternalId: 'linear-link', title: 'Destination', descriptionMd: 'Imported destination', statusName: 'Todo', labelNames: [], relations: [], comments: [], attachments: [] },
      ],
    };
    const run = await h.services.importer.createRun(owner, { source: 'linear', bundle });
    const mapping = run.mapping as ImportMapping;
    await h.services.importer.updateMapping(owner, run.id, {
      ...mapping,
      teams: { 'linear-link': { mode: 'create', key: 'DEZ', name: 'Destination' } },
    });
    await h.services.importer.dryRun(owner, run.id);
    await h.services.importer.commit(owner, run.id);
    await h.services.importer.runCommit(run.id);

    const imported = await h.pool.query<{ entity_id: string }>(
      `select entity_id from import_items where run_id = $1 and kind = 'issue' and external_id = 'SAA-77'`,
      [run.id],
    );
    const destinationId = imported.rows[0]!.entity_id;
    await h.pool.query('update issues set number = 72, description_md = $1 where id = $2', [stale, destinationId]);

    const service = h.services.importReferenceRepairs;
    const scan = await service.startScan(owner, run.id);
    await service.scanJob(scan.id, scan.previewVersion);
    const preview = await service.get(owner, scan.id);
    expect(preview?.summary).toMatchObject({ targets: 1, references: 1, unmapped: 0 });
    expect(preview?.targets).toHaveLength(1);
    const target = preview!.targets[0]!;
    const repaired = `[DEZ-72](/issue/${destinationId})`;
    expect(target).toMatchObject({
      targetKind: 'issue_description',
      targetId: destinationId,
      sourceExternalId: 'SAA-77',
      beforeMd: stale,
      afterMd: repaired,
      referenceCount: 1,
      status: 'pending',
      mappingSnapshot: [{
        sourceExternalId: 'SAA-77',
        destinationId,
        identifier: 'DEZ-72',
      }],
    });

    await service.apply(owner, scan.id, preview!.previewHash, true);
    await service.applyJob(scan.id, preview!.previewHash);
    const persisted = await h.pool.query<{ description_md: string }>('select description_md from issues where id = $1', [destinationId]);
    expect(persisted.rows[0]!.description_md).toBe(repaired);

    const rescan = await service.startScan(owner, run.id);
    await service.scanJob(rescan.id, rescan.previewVersion);
    expect((await service.get(owner, rescan.id))?.summary).toMatchObject({ targets: 0, references: 0, alreadyCorrect: 1 });
  });
});
