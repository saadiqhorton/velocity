import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  comments,
  importItems,
  importReferenceRepairTargets,
  importReferenceRepairs,
  importRuns,
  issues,
  teams,
} from '@velocity/schema';
import type { ImportBundle } from '@velocity/schema';
import { ServiceBase } from './base';
import type { ServiceActor } from './context';
import type { AuditService } from './audit';
import { actorUserId } from './context';
import type { Tx } from './db';
import { notFound, validation } from './errors';
import { assertCan } from './lib/permissions';
import { findImportedReferenceKeys, rewriteImportedReferences } from './lib/import-reference-rewrite';

export type ImportReferenceRepairRow = typeof importReferenceRepairs.$inferSelect;
export type ImportReferenceRepairTargetRow = typeof importReferenceRepairTargets.$inferSelect;

const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const emptySummary = () => ({ targets: 0, references: 0, applied: 0, skipped: 0, alreadyCorrect: 0, unmapped: 0, ambiguous: 0, stale: 0, missing: 0, codeSkipped: 0 });
const APPLY_BATCH_SIZE = 100;

export interface ImportReferenceRepairPreview extends ImportReferenceRepairRow {
  targets: ImportReferenceRepairTargetRow[];
}

export class ImportReferenceRepairService extends ServiceBase {
  private audit!: AuditService;
  /** Deterministic race hook used only by database tests. */
  beforeApplyContentWrite: ((target: ImportReferenceRepairTargetRow) => Promise<void>) | null = null;

  bind(audit: AuditService): void { this.audit = audit; }

  async startScan(actor: ServiceActor, runId: string): Promise<ImportReferenceRepairRow> {
    assertCan(actor, 'workspace.import_export');
    return this.tx(async (tx) => {
      // Transaction-scoped advisory lock serializes scan submission for this import before state is reread.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${runId}, 0))`);
      const [run] = await tx.select().from(importRuns).where(eq(importRuns.id, runId)).for('update');
      if (!run) throw notFound('Import run');
      if (run.status !== 'completed') throw validation('Reference repair is available only for completed import runs.');
      const [latest] = await tx.select().from(importReferenceRepairs)
        .where(eq(importReferenceRepairs.runId, runId)).orderBy(desc(importReferenceRepairs.createdAt)).limit(1);
      if (latest?.status === 'applying' || latest?.status === 'scanning') throw validation('A reference repair is already running for this import.');
      if (latest?.status === 'preview') await tx.update(importReferenceRepairs).set({ status: 'superseded', updatedAt: this.now() })
        .where(and(eq(importReferenceRepairs.id, latest.id), eq(importReferenceRepairs.status, 'preview')));
      const [repair] = await tx.insert(importReferenceRepairs).values({
        runId, createdBy: actorUserId(actor), status: 'scanning', previewVersion: (latest?.previewVersion ?? 0) + 1,
        previewHash: '', summary: emptySummary(),
      }).returning();
      if (!repair) throw new Error('Could not create reference repair preview.');
      const jobId = await this.jobs.sendInTx(tx, 'import_reference_repairs', { type: 'scan', repairId: repair.id, previewVersion: repair.previewVersion });
      if (!jobId) throw new Error('The reference scan job was not accepted by the queue.');
      await this.audit.log(tx, actor, { action: 'import.reference_repair.scan', objectType: 'import_reference_repair', objectId: repair.id, changes: { runId } });
      return repair;
    });
  }

  async get(actor: ServiceActor, repairId: string, args: { first?: number; offset?: number } = {}): Promise<ImportReferenceRepairPreview | null> {
    assertCan(actor, 'workspace.import_export');
    const [repair] = await this.db.select().from(importReferenceRepairs).where(eq(importReferenceRepairs.id, repairId));
    if (!repair) return null;
    const targets = repair.status === 'scanning' || repair.status === 'failed' || repair.status === 'superseded'
      ? []
      : await this.db.select().from(importReferenceRepairTargets)
      .where(eq(importReferenceRepairTargets.repairId, repairId))
      .orderBy(importReferenceRepairTargets.targetKind, importReferenceRepairTargets.sourceExternalId, importReferenceRepairTargets.targetId)
      .limit(Math.min(Math.max(args.first ?? 50, 1), 100))
      .offset(Math.max(args.offset ?? 0, 0));
    return { ...repair, targets };
  }

  async scanJob(repairId: string, expectedVersion: number): Promise<void> {
    const [initial] = await this.db.select({ runId: importReferenceRepairs.runId })
      .from(importReferenceRepairs).where(eq(importReferenceRepairs.id, repairId));
    if (!initial) return;
    const client = await this.pool.connect();
    try {
      // Session advisory lock serializes scan deliveries without holding one transaction during the scan.
      await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [initial.runId]);
      const [repair] = await this.db.select().from(importReferenceRepairs).where(eq(importReferenceRepairs.id, repairId));
      if (!repair || repair.status !== 'scanning' || repair.previewVersion !== expectedVersion) return;
      const [run] = await this.db.select().from(importRuns).where(eq(importRuns.id, repair.runId));
      if (!run || run.status !== 'completed') throw validation('The source import is no longer completed.');
      const bundle = run.config as ImportBundle;
      const importRows = await this.db.select({ externalId: importItems.externalId, entityId: importItems.entityId })
        .from(importItems).where(and(eq(importItems.runId, run.id), eq(importItems.kind, 'issue')));
      const ids = [...new Set(importRows.map((r) => r.entityId))];
      const issueRows = ids.length ? await this.db.select({ id: issues.id, number: issues.number, teamKey: teams.key, teamId: issues.teamId, descriptionMd: issues.descriptionMd })
        .from(issues).innerJoin(teams, eq(teams.id, issues.teamId)).where(inArray(issues.id, ids)) : [];
      const byId = new Map(issueRows.map((r) => [r.id, r]));
      const idBySource = new Map(importRows.map((r) => [r.externalId, r.entityId]));
      const countsByKey = new Map<string, number>();
      for (const issue of bundle.issues) countsByKey.set(issue.externalId, (countsByKey.get(issue.externalId) ?? 0) + 1);
      const mapping = new Map<string, { id: string; identifier: string } | null>();
      const scannedIssueKeys = new Set<string>();
      for (const source of bundle.issues) {
        if (scannedIssueKeys.has(source.externalId)) continue;
        scannedIssueKeys.add(source.externalId);
        const id = idBySource.get(source.externalId);
        const row = id ? byId.get(id) : undefined;
        mapping.set(source.externalId, countsByKey.get(source.externalId) === 1 && row ? { id: row.id, identifier: `${row.teamKey}-${row.number}` } : null);
      }
      const summary = emptySummary();
      const targets: (typeof importReferenceRepairTargets.$inferInsert)[] = [];
      const sourceForId = new Map(importRows.map((r) => [r.entityId, r.externalId]));
      const candidateTexts: { kind: 'issue_description' | 'comment_body'; id: string; provenanceKey: string; sourceKey: string; text: string }[] = [];
      const scannedTargetKeys = new Set<string>();
      for (const source of bundle.issues) {
        if (scannedTargetKeys.has(source.externalId)) continue;
        scannedTargetKeys.add(source.externalId);
        const id = idBySource.get(source.externalId);
        if (!id || !byId.has(id)) { summary.missing++; continue; }
        candidateTexts.push({ kind: 'issue_description', id, provenanceKey: source.externalId, sourceKey: source.externalId, text: byId.get(id)!.descriptionMd });
      }
      const commentItems = await this.db.select({ externalId: importItems.externalId, entityId: importItems.entityId })
        .from(importItems).where(and(eq(importItems.runId, run.id), eq(importItems.kind, 'comment')));
      const commentIds = [...new Set(commentItems.map((r) => r.entityId))];
      const commentRows = commentIds.length ? await this.db.select({ id: comments.id, issueId: comments.issueId, bodyMd: comments.bodyMd })
        .from(comments).where(inArray(comments.id, commentIds)) : [];
      const commentById = new Map(commentRows.map((r) => [r.id, r]));
      for (const item of commentItems) {
        const row = commentById.get(item.entityId);
        if (!row) { summary.missing++; continue; }
        const sourceKey = sourceForId.get(row.issueId);
        if (!sourceKey) { summary.unmapped++; continue; }
        candidateTexts.push({ kind: 'comment_body', id: row.id, provenanceKey: item.externalId, sourceKey, text: row.bodyMd });
      }
      for (const target of candidateTexts) {
        const rewritten = rewriteImportedReferences(target.text, mapping);
        summary.references += rewritten.edits.length;
        summary.alreadyCorrect += rewritten.alreadyCorrect;
        for (const key of rewritten.unmapped) {
          const count = countsByKey.get(key) ?? 0;
          if (count > 1) summary.ambiguous++;
          else summary.unmapped++;
        }
        summary.codeSkipped += rewritten.skippedCodeReferences;
        if (!rewritten.edits.length) continue;
        summary.targets++;
        const mappingSnapshot = [...new Map(rewritten.edits.map((edit) => [edit.sourceKey, {
          sourceExternalId: edit.sourceKey, destinationId: edit.destinationId, identifier: edit.after,
        }])).values()];
        targets.push({
          repairId: repair.id,
          targetKind: target.kind,
          targetId: target.id,
          provenanceKey: target.provenanceKey,
          sourceExternalId: target.sourceKey,
          mappingSnapshot,
          expectedHash: digest(target.text),
          beforeMd: target.text,
          afterMd: rewritten.text,
          context: { before: context(target.text, rewritten.edits, false), after: context(rewritten.text, rewritten.edits, true) },
          referenceCount: rewritten.edits.length,
          status: 'pending',
          skipReason: null,
        });
      }
      const previewHash = digest(JSON.stringify({ version: repair.previewVersion, runId: run.id, targets: targets.map((t) => [t.targetKind, t.targetId, t.expectedHash, t.afterMd, t.mappingSnapshot]) }));
      const mayReplace = await this.tx(async (tx) => {
        const [locked] = await tx.select({ status: importReferenceRepairs.status, previewVersion: importReferenceRepairs.previewVersion })
          .from(importReferenceRepairs).where(eq(importReferenceRepairs.id, repair.id)).for('update');
        if (!locked || locked.status !== 'scanning' || locked.previewVersion !== expectedVersion) return false;
        await tx.delete(importReferenceRepairTargets).where(eq(importReferenceRepairTargets.repairId, repair.id));
        return true;
      });
      if (!mayReplace) return;
      for (let offset = 0; offset < targets.length; offset += 200) {
        const chunk = targets.slice(offset, offset + 200);
        const inserted = await this.tx(async (tx) => {
          const [locked] = await tx.select({ status: importReferenceRepairs.status, previewVersion: importReferenceRepairs.previewVersion })
            .from(importReferenceRepairs).where(eq(importReferenceRepairs.id, repair.id)).for('update');
          if (!locked || locked.status !== 'scanning' || locked.previewVersion !== expectedVersion) return false;
          await tx.insert(importReferenceRepairTargets).values(chunk);
          return true;
        });
        if (!inserted) return;
      }
      await this.tx(async (tx) => {
        const [locked] = await tx.select({ status: importReferenceRepairs.status, previewVersion: importReferenceRepairs.previewVersion })
          .from(importReferenceRepairs).where(eq(importReferenceRepairs.id, repair.id)).for('update');
        if (!locked || locked.status !== 'scanning' || locked.previewVersion !== expectedVersion) return;
        await tx.update(importReferenceRepairs).set({ status: 'preview', previewHash, summary, error: null, updatedAt: this.now() })
          .where(and(eq(importReferenceRepairs.id, repair.id), eq(importReferenceRepairs.status, 'scanning'), eq(importReferenceRepairs.previewVersion, expectedVersion)));
      });
    } finally {
      await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [initial.runId]).catch(() => undefined);
      client.release();
    }
  }

  async apply(actor: ServiceActor, repairId: string, previewHash: string, confirmed: boolean): Promise<ImportReferenceRepairRow> {
    assertCan(actor, 'workspace.import_export');
    if (!confirmed) throw validation('Confirm the reviewed reference changes before applying them.');
    return this.tx(async (tx) => {
      const [repair] = await tx.select().from(importReferenceRepairs).where(eq(importReferenceRepairs.id, repairId)).for('update');
      if (!repair) throw notFound('Reference repair preview');
      if (repair.status === 'completed' || repair.status === 'applying') return repair;
      if (repair.status !== 'preview' || repair.previewHash !== previewHash) throw validation('This preview is stale. Rescan the import before applying changes.');
      const [row] = await tx.update(importReferenceRepairs).set({ status: 'applying', updatedAt: this.now() })
        .where(and(eq(importReferenceRepairs.id, repairId), eq(importReferenceRepairs.status, 'preview'), eq(importReferenceRepairs.previewHash, previewHash))).returning();
      if (!row) throw validation('This preview changed before it could be applied. Rescan the import.');
      const jobId = await this.jobs.sendInTx(tx, 'import_reference_repairs', { type: 'apply', repairId, previewHash });
      if (!jobId) throw new Error('The reference apply job was not accepted by the queue.');
      await this.audit.log(tx, actor, { action: 'import.reference_repair.apply', objectType: 'import_reference_repair', objectId: repairId, changes: { previewHash } });
      return row;
    });
  }

  async applyJob(repairId: string, previewHash: string): Promise<void> {
    await this.tx(async (tx) => {
      const [repair] = await tx.select().from(importReferenceRepairs).where(eq(importReferenceRepairs.id, repairId)).for('update');
      if (!repair || repair.status !== 'applying' || repair.previewHash !== previewHash) return;
      const [run] = await tx.select().from(importRuns).where(eq(importRuns.id, repair.runId));
      if (!run || run.status !== 'completed') throw validation('The source import is no longer completed.');
      const targets = await tx.select().from(importReferenceRepairTargets).where(and(
        eq(importReferenceRepairTargets.repairId, repairId), eq(importReferenceRepairTargets.status, 'pending'),
      )).orderBy(asc(importReferenceRepairTargets.id)).limit(APPLY_BATCH_SIZE).for('update', { skipLocked: true });
      const bundle = run.config as ImportBundle;
      const sourceKeyCounts = new Map<string, number>();
      for (const issue of bundle.issues) sourceKeyCounts.set(issue.externalId, (sourceKeyCounts.get(issue.externalId) ?? 0) + 1);
      for (const target of targets) {
        const [provenance] = await tx.select({ entityId: importItems.entityId }).from(importItems).where(and(
          eq(importItems.runId, run.id),
          eq(importItems.kind, target.targetKind === 'issue_description' ? 'issue' : 'comment'),
          eq(importItems.externalId, target.provenanceKey),
        ));
        if (!provenance || provenance.entityId !== target.targetId) {
          await this.setTargetResult(tx, target.id, 'unmapped');
          continue;
        }
        if (digest(target.beforeMd) !== target.expectedHash) {
          await this.setTargetResult(tx, target.id, 'stale');
          continue;
        }
        const mapping = await this.resolveCurrentMapping(tx, run.id, target.beforeMd, sourceKeyCounts);
        const freshText = rewriteImportedReferences(target.beforeMd, mapping).text;
        if (freshText !== target.afterMd) {
          await this.setTargetResult(tx, target.id, 'stale');
          continue;
        }
        if (this.beforeApplyContentWrite) await this.beforeApplyContentWrite(target);
        const updated = target.targetKind === 'issue_description'
          ? await tx.update(issues).set({ descriptionMd: freshText }).where(and(eq(issues.id, target.targetId), eq(issues.descriptionMd, target.beforeMd))).returning({ id: issues.id })
          : await tx.update(comments).set({ bodyMd: freshText }).where(and(eq(comments.id, target.targetId), eq(comments.bodyMd, target.beforeMd))).returning({ id: comments.id });
        if (updated.length) {
          await tx.update(importReferenceRepairTargets).set({ status: 'applied', appliedAt: this.now(), skipReason: null }).where(eq(importReferenceRepairTargets.id, target.id));
          continue;
        }
        const exists = target.targetKind === 'issue_description'
          ? await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, target.targetId))
          : await tx.select({ id: comments.id }).from(comments).where(eq(comments.id, target.targetId));
        await this.setTargetResult(tx, target.id, exists.length ? 'stale' : 'missing');
      }

      const [pending] = await tx.select({ count: sql<number>`count(*)::int` }).from(importReferenceRepairTargets)
        .where(and(eq(importReferenceRepairTargets.repairId, repairId), eq(importReferenceRepairTargets.status, 'pending')));
      if ((pending?.count ?? 0) > 0) {
        const jobId = await this.jobs.sendInTx(tx, 'import_reference_repairs', { type: 'apply', repairId, previewHash });
        if (!jobId) throw new Error('The reference apply continuation was not accepted by the queue.');
        return;
      }

      const statuses = await tx.select({ status: importReferenceRepairTargets.status, skipReason: importReferenceRepairTargets.skipReason })
        .from(importReferenceRepairTargets).where(eq(importReferenceRepairTargets.repairId, repairId));
      if (statuses.some((row) => row.status === 'pending')) {
        const jobId = await this.jobs.sendInTx(tx, 'import_reference_repairs', { type: 'apply', repairId, previewHash });
        if (!jobId) throw new Error('The reference apply continuation was not accepted by the queue.');
        return;
      }
      const scanSummary = repair.summary;
      const summary = {
        ...scanSummary,
        applied: statuses.filter((row) => row.status === 'applied').length,
        skipped: statuses.filter((row) => row.status === 'skipped').length,
        stale: statuses.filter((row) => row.skipReason === 'stale').length,
        missing: (scanSummary.missing ?? 0) + statuses.filter((row) => row.skipReason === 'missing').length,
        unmapped: (scanSummary.unmapped ?? 0) + statuses.filter((row) => row.skipReason === 'unmapped').length,
      };
      const [completed] = await tx.update(importReferenceRepairs).set({ status: 'completed', summary, updatedAt: this.now() })
        .where(and(eq(importReferenceRepairs.id, repairId), eq(importReferenceRepairs.status, 'applying'), eq(importReferenceRepairs.previewHash, previewHash)))
        .returning({ id: importReferenceRepairs.id });
      if (!completed) return;
      await tx.insert(importItems).values({ runId: run.id, kind: 'reference_repair_complete', externalId: repairId, entityId: repairId }).onConflictDoNothing();
    });
  }

  async failJob(data: { type: 'scan'; repairId: string; previewVersion: number } | { type: 'apply'; repairId: string; previewHash: string }, message: string): Promise<void> {
    const [repair] = await this.db.select().from(importReferenceRepairs).where(eq(importReferenceRepairs.id, data.repairId));
    if (!repair) return;
    await this.tx(async (tx) => {
      const [locked] = await tx.select().from(importReferenceRepairs).where(eq(importReferenceRepairs.id, data.repairId)).for('update');
      if (!locked) return;
      const expected = data.type === 'scan'
        ? locked.status === 'scanning' && locked.previewVersion === data.previewVersion
        : locked.status === 'applying' && locked.previewHash === data.previewHash;
      if (!expected) return;
      await tx.update(importReferenceRepairs).set({ status: 'failed', error: message.slice(0, 2000), updatedAt: this.now() })
        .where(and(eq(importReferenceRepairs.id, locked.id), eq(importReferenceRepairs.status, locked.status)));
    });
  }

  private async setTargetResult(tx: Tx, id: string, reason: 'stale' | 'missing' | 'unmapped'): Promise<void> {
    await tx.update(importReferenceRepairTargets).set({ status: 'skipped', skipReason: reason }).where(eq(importReferenceRepairTargets.id, id));
  }

  private async resolveCurrentMapping(
    tx: Tx,
    runId: string,
    text: string,
    sourceKeyCounts: ReadonlyMap<string, number>,
  ): Promise<Map<string, { id: string; identifier: string } | null>> {
    const sourceItems = await tx.select({ externalId: importItems.externalId, entityId: importItems.entityId }).from(importItems)
      .where(and(eq(importItems.runId, runId), eq(importItems.kind, 'issue')));
    const idBySource = new Map(sourceItems.map((row) => [row.externalId, row.entityId]));
    const referenced = findImportedReferenceKeys(text, idBySource.keys());
    const mapping = new Map<string, { id: string; identifier: string } | null>(sourceItems.map((row) => [row.externalId, null]));
    const ids = [...new Set(referenced.flatMap((key) => idBySource.has(key) ? [idBySource.get(key)!] : []))];
    const issueRows = ids.length ? await tx.select({ id: issues.id, number: issues.number, teamId: issues.teamId }).from(issues)
      .where(inArray(issues.id, ids)).for('update') : [];
    const teamIds = [...new Set(issueRows.map((row) => row.teamId))];
    const teamRows = teamIds.length ? await tx.select({ id: teams.id, key: teams.key }).from(teams)
      .where(inArray(teams.id, teamIds)).for('share') : [];
    const keyByTeam = new Map(teamRows.map((row) => [row.id, row.key]));
    const issueById = new Map(issueRows.map((row) => [row.id, row]));
    for (const sourceKey of referenced) {
      const id = idBySource.get(sourceKey);
      const issue = id ? issueById.get(id) : undefined;
      const teamKey = issue ? keyByTeam.get(issue.teamId) : undefined;
      if (id && issue && teamKey && (sourceKeyCounts.get(sourceKey) ?? 0) === 1) {
        mapping.set(sourceKey, { id, identifier: `${teamKey}-${issue.number}` });
      }
    }
    return mapping;
  }
}

function context(text: string, edits: { start: number; end: number; after: string }[], after: boolean): string {
  const edit = edits[0];
  if (!edit) return text.slice(0, 180);
  const start = after ? edit.start + edit.after.length - (edit.end - edit.start) : edit.start;
  return text.slice(Math.max(0, start - 60), Math.min(text.length, start + 60));
}
