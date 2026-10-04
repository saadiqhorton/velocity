import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import {
  attachments,
  comments,
  cycles,
  exports as exportsTable,
  issueLabels,
  issueRelations,
  issues,
  labels,
  milestones,
  projectTeams,
  projects,
  statuses,
  teams,
  users,
  views,
  workflows,
  workspace,
} from '@velocity/schema';
import { ServiceBase } from './base';
import type { AuditService } from './audit';
import type { ServiceActor } from './context';
import { notFound } from './errors';
import { assertCan } from './lib/permissions';

export type ExportRow = typeof exportsTable.$inferSelect;
export const EXPORT_FORMAT_VERSION = 1;

/** Full workspace export (SPEC §7.2): versioned JSON, owner-triggered, background-generated. */
export class ExportService extends ServiceBase {
  private audit!: AuditService;
  bind(audit: AuditService): void {
    this.audit = audit;
  }

  async request(actor: ServiceActor): Promise<ExportRow> {
    assertCan(actor, 'workspace.import_export');
    const [row] = await this.db.insert(exportsTable).values({ createdBy: actor.userId }).returning();
    await this.audit.log(this.db, actor, { action: 'workspace.exported', objectType: 'export', objectId: row!.id });
    await this.jobs.send('exports', { type: 'workspace_export', exportId: row!.id });
    return row!;
  }

  async list(actor: ServiceActor): Promise<ExportRow[]> {
    assertCan(actor, 'workspace.import_export');
    return this.db.select().from(exportsTable).orderBy(desc(exportsTable.createdAt)).limit(20);
  }

  async get(actor: ServiceActor, id: string): Promise<ExportRow> {
    assertCan(actor, 'workspace.import_export');
    const [row] = await this.db.select().from(exportsTable).where(eq(exportsTable.id, id));
    if (!row) throw notFound('Export');
    return row;
  }

  /** Job handler. */
  async generate(exportId: string): Promise<void> {
    await this.db.update(exportsTable).set({ status: 'running' }).where(eq(exportsTable.id, exportId));
    try {
      const [ws] = await this.db.select().from(workspace);
      const data = {
        format: 'velocity-export',
        version: EXPORT_FORMAT_VERSION,
        exportedAt: this.now().toISOString(),
        workspace: ws ? { name: ws.name, slug: ws.slug, timezone: ws.timezone, locale: ws.locale } : null,
        members: (await this.db.select().from(users)).map((user) => {
          return Object.fromEntries(Object.entries(user).filter(([key]) => key !== 'passwordHash'));
        }),
        teams: await this.db.select().from(teams),
        workflows: await this.db.select().from(workflows),
        statuses: await this.db.select().from(statuses),
        labels: await this.db.select().from(labels),
        cycles: await this.db.select().from(cycles),
        projects: await this.db.select().from(projects),
        projectTeams: await this.db.select().from(projectTeams),
        milestones: await this.db.select().from(milestones),
        issues: (await this.db.select().from(issues)).map((issue) => {
          return Object.fromEntries(Object.entries(issue).filter(([key]) => key !== 'searchVector'));
        }),
        issueLabels: await this.db.select().from(issueLabels),
        issueRelations: await this.db.select().from(issueRelations),
        comments: await this.db.select().from(comments),
        views: await this.db.select().from(views),
        attachmentManifest: (await this.db.select().from(attachments)).map((a) => ({ id: a.id, issueId: a.issueId, commentId: a.commentId, filename: a.filename, mime: a.mime, size: a.size, storagePath: a.storagePath })),
      };
      await mkdir(this.config.exportDir, { recursive: true });
      const filePath = join(this.config.exportDir, `velocity-export-${exportId}.json`);
      await writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
      const size = (await stat(filePath)).size;
      await this.db.update(exportsTable).set({ status: 'completed', filePath, size, completedAt: this.now() }).where(eq(exportsTable.id, exportId));
    } catch (err) {
      await this.db.update(exportsTable).set({ status: 'failed', error: err instanceof Error ? err.message : String(err) }).where(eq(exportsTable.id, exportId));
      throw err;
    }
  }
}
