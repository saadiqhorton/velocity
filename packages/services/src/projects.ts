import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { issues, milestones, projectTeams, projects, statuses, users } from '@velocity/schema';
import type { MilestoneStatus, PaletteColor, ProjectHealth, ProjectStatus } from '@velocity/schema';
import { MILESTONE_STATUSES, PALETTE_COLORS, PROJECT_HEALTH, PROJECT_STATUSES } from '@velocity/schema';
import { publish } from '@velocity/events';
import { ServiceBase } from './base';
import type { AuditService } from './audit';
import type { ServiceActor } from './context';
import { actorUserId, toActorRef } from './context';
import type { DbOrTx } from './db';
import { notFound, validation } from './errors';
import { orderBetween } from './lib/fractional-order';
import { sanitizeMarkdown } from './lib/markdown';
import { assertCan } from './lib/permissions';

export type ProjectRow = typeof projects.$inferSelect;
export type MilestoneRow = typeof milestones.$inferSelect;

/**
 * Event-driven progress recompute (SPEC §3.9): count + points, canceled issues excluded.
 * Called inside the issue-mutating transaction so the cache never drifts.
 */
export async function recomputeProjectProgress(executor: DbOrTx, projectIds: string[]): Promise<void> {
  for (const projectId of new Set(projectIds)) {
    await executor.execute(sql`
      update projects p set
        progress_total = s.total, progress_done = s.done,
        progress_points_total = s.pt, progress_points_done = s.pd
      from (
        select
          count(*) filter (where st.category <> 'canceled')::int as total,
          count(*) filter (where st.category = 'done')::int as done,
          coalesce(sum(i.estimate) filter (where st.category <> 'canceled'), 0)::int as pt,
          coalesce(sum(i.estimate) filter (where st.category = 'done'), 0)::int as pd
        from issues i join statuses st on st.id = i.status_id
        where i.project_id = ${projectId} and i.trashed_at is null and i.moved_to_issue_id is null
      ) s
      where p.id = ${projectId}`);
  }
}

export interface ProjectInput {
  name: string;
  descriptionMd?: string | null;
  icon?: string | null;
  color?: PaletteColor | null;
  status?: ProjectStatus | null;
  leadId?: string | null;
  targetDate?: string | null;
  health?: ProjectHealth | null;
  teamIds?: string[] | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(d: string | null | undefined, field: string): void {
  if (d && (!DATE_RE.test(d) || Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()))) {
    throw validation('Use a date like 2026-12-31.', { field });
  }
}

export class ProjectService extends ServiceBase {
  private audit!: AuditService;
  bind(audit: AuditService): void {
    this.audit = audit;
  }

  async list(_actor: ServiceActor, opts: { status?: ProjectStatus[] | null; teamId?: string | null; includeArchived?: boolean } = {}): Promise<ProjectRow[]> {
    const conds = [isNull(projects.trashedAt)];
    if (!opts.includeArchived) conds.push(isNull(projects.archivedAt));
    if (opts.status?.length) conds.push(inArray(projects.status, opts.status));
    if (opts.teamId) {
      // Team's projects = explicitly associated OR containing the team's issues (SPEC §3.4 sidebar).
      conds.push(sql`(exists (select 1 from project_teams pt where pt.project_id = projects.id and pt.team_id = ${opts.teamId})
        or exists (select 1 from issues i where i.project_id = projects.id and i.team_id = ${opts.teamId} and i.trashed_at is null))`);
    }
    return this.db
      .select()
      .from(projects)
      .where(and(...conds))
      .orderBy(asc(projects.sortOrder), desc(projects.createdAt));
  }

  async get(id: string): Promise<ProjectRow | null> {
    const [p] = await this.db.select().from(projects).where(eq(projects.id, id));
    return p ?? null;
  }

  async getMany(ids: readonly string[]): Promise<ProjectRow[]> {
    if (!ids.length) return [];
    return this.db.select().from(projects).where(inArray(projects.id, [...ids]));
  }

  async require(id: string): Promise<ProjectRow> {
    const p = await this.get(id);
    if (!p || p.trashedAt) throw notFound('Project');
    return p;
  }

  async teamIds(projectIds: readonly string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!projectIds.length) return out;
    const rows = await this.db.select().from(projectTeams).where(inArray(projectTeams.projectId, [...projectIds]));
    for (const r of rows) out.set(r.projectId, [...(out.get(r.projectId) ?? []), r.teamId]);
    return out;
  }

  private validate(input: Partial<ProjectInput>): void {
    if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 80)) {
      throw validation('Project names are 1–80 characters.', { field: 'name' });
    }
    if (input.color && !PALETTE_COLORS.includes(input.color)) throw validation('Pick a color from the palette.', { field: 'color' });
    if (input.status && !PROJECT_STATUSES.includes(input.status)) throw validation('Unknown project status.', { field: 'status' });
    if (input.health && !PROJECT_HEALTH.includes(input.health)) throw validation('Unknown project health.', { field: 'health' });
    checkDate(input.targetDate, 'targetDate');
  }

  private async assertLead(leadId: string | null | undefined): Promise<void> {
    if (!leadId) return;
    const [u] = await this.db.select().from(users).where(eq(users.id, leadId));
    if (!u || u.deletedAt) throw notFound('Lead');
  }

  async create(actor: ServiceActor, input: ProjectInput): Promise<ProjectRow> {
    assertCan(actor, 'project.write');
    this.validate(input);
    await this.assertLead(input.leadId);
    return this.tx(async (tx) => {
      const [m] = await tx.select({ m: max(projects.sortOrder) }).from(projects);
      const [p] = await tx
        .insert(projects)
        .values({
          name: input.name.trim(),
          descriptionMd: sanitizeMarkdown(input.descriptionMd ?? ''),
          icon: input.icon ?? null,
          color: input.color ?? 'blue',
          status: input.status ?? 'planned',
          leadId: input.leadId ?? null,
          targetDate: input.targetDate ?? null,
          health: input.health ?? null,
          createdBy: actorUserId(actor),
          sortOrder: (m?.m ?? 0) + 1000,
        })
        .returning();
      if (!p) throw new Error('project insert failed');
      if (input.teamIds?.length) {
        await tx.insert(projectTeams).values([...new Set(input.teamIds)].map((teamId) => ({ projectId: p.id, teamId }))).onConflictDoNothing();
      }
      await publish(tx, 'project.created', { projectId: p.id, actor: toActorRef(actor) });
      return p;
    });
  }

  async update(actor: ServiceActor, id: string, patch: Partial<ProjectInput>): Promise<ProjectRow> {
    assertCan(actor, 'project.write');
    this.validate(patch);
    await this.assertLead(patch.leadId);
    const set: Partial<typeof projects.$inferInsert> = { updatedAt: this.now() };
    const changed: string[] = [];
    const assign = <K extends keyof typeof projects.$inferInsert>(k: K, v: (typeof projects.$inferInsert)[K]) => {
      set[k] = v;
      changed.push(k);
    };
    if (patch.name != null) assign('name', patch.name.trim());
    if (patch.descriptionMd != null) assign('descriptionMd', sanitizeMarkdown(patch.descriptionMd));
    if (patch.icon !== undefined) assign('icon', patch.icon);
    if (patch.color) assign('color', patch.color);
    if (patch.status) assign('status', patch.status);
    if (patch.leadId !== undefined) assign('leadId', patch.leadId);
    if (patch.targetDate !== undefined) assign('targetDate', patch.targetDate);
    if (patch.health !== undefined) assign('health', patch.health);
    return this.tx(async (tx) => {
      const [p] = await tx.update(projects).set(set).where(and(eq(projects.id, id), isNull(projects.trashedAt))).returning();
      if (!p) throw notFound('Project');
      if (patch.teamIds) {
        await tx.delete(projectTeams).where(eq(projectTeams.projectId, id));
        if (patch.teamIds.length) {
          await tx.insert(projectTeams).values([...new Set(patch.teamIds)].map((teamId) => ({ projectId: id, teamId })));
        }
        changed.push('teamIds');
      }
      await publish(tx, 'project.updated', { projectId: id, changedFields: changed, actor: toActorRef(actor) });
      return p;
    });
  }

  async setArchived(actor: ServiceActor, id: string, archived: boolean): Promise<ProjectRow> {
    assertCan(actor, 'project.write');
    const [p] = await this.db.update(projects).set({ archivedAt: archived ? this.now() : null, updatedAt: this.now() }).where(eq(projects.id, id)).returning();
    if (!p) throw notFound('Project');
    await publish(this.db, 'project.updated', { projectId: id, changedFields: ['archivedAt'], actor: toActorRef(actor) });
    return p;
  }

  /** Trash a project: its issues are detached (kept), the project is soft-deleted. */
  async trash(actor: ServiceActor, id: string): Promise<void> {
    assertCan(actor, 'project.write');
    const p = await this.require(id);
    await this.tx(async (tx) => {
      await tx.update(issues).set({ projectId: null, milestoneId: null, updatedAt: this.now() }).where(eq(issues.projectId, id));
      await tx.update(projects).set({ trashedAt: this.now(), updatedAt: this.now() }).where(eq(projects.id, id));
      await this.audit.log(tx, actor, { action: 'project.deleted', objectType: 'project', objectId: id, changes: { name: p.name } });
      await publish(tx, 'project.updated', { projectId: id, changedFields: ['trashedAt'], actor: toActorRef(actor) });
    });
  }

  async reorder(actor: ServiceActor, id: string, beforeId: string | null, afterId: string | null): Promise<ProjectRow> {
    assertCan(actor, 'project.write');
    const ids = [beforeId, afterId].filter((x): x is string => Boolean(x));
    const n = ids.length ? await this.db.select().from(projects).where(inArray(projects.id, ids)) : [];
    const [p] = await this.db
      .update(projects)
      .set({ sortOrder: orderBetween(n.find((x) => x.id === beforeId)?.sortOrder ?? null, n.find((x) => x.id === afterId)?.sortOrder ?? null) })
      .where(eq(projects.id, id))
      .returning();
    if (!p) throw notFound('Project');
    return p;
  }

  // ───────────── Milestones ─────────────

  async milestones(projectIds: readonly string[]): Promise<MilestoneRow[]> {
    if (!projectIds.length) return [];
    return this.db.select().from(milestones).where(inArray(milestones.projectId, [...projectIds])).orderBy(asc(milestones.sortOrder));
  }

  async getMilestones(ids: readonly string[]): Promise<MilestoneRow[]> {
    if (!ids.length) return [];
    return this.db.select().from(milestones).where(inArray(milestones.id, [...ids]));
  }

  /** Milestone rollup (SPEC §3.9): issue counts per milestone. */
  async milestoneProgress(milestoneIds: readonly string[]): Promise<Map<string, { done: number; total: number }>> {
    const out = new Map<string, { done: number; total: number }>();
    if (!milestoneIds.length) return out;
    const rows = await this.db
      .select({
        id: issues.milestoneId,
        total: sql<number>`count(*) filter (where ${statuses.category} <> 'canceled')::int`,
        done: sql<number>`count(*) filter (where ${statuses.category} = 'done')::int`,
      })
      .from(issues)
      .innerJoin(statuses, eq(statuses.id, issues.statusId))
      .where(and(inArray(issues.milestoneId, [...milestoneIds]), isNull(issues.trashedAt), isNull(issues.movedToIssueId)))
      .groupBy(issues.milestoneId);
    for (const r of rows) if (r.id) out.set(r.id, { done: r.done, total: r.total });
    return out;
  }

  async createMilestone(
    actor: ServiceActor,
    projectId: string,
    input: { name: string; description?: string | null; targetDate?: string | null; status?: MilestoneStatus | null },
  ): Promise<MilestoneRow> {
    assertCan(actor, 'project.write');
    await this.require(projectId);
    const name = input.name.trim();
    if (!name || name.length > 80) throw validation('Milestone names are 1–80 characters.', { field: 'name' });
    checkDate(input.targetDate, 'targetDate');
    if (input.status && !MILESTONE_STATUSES.includes(input.status)) throw validation('Unknown milestone status.', { field: 'status' });
    const [m] = await this.db.select({ m: max(milestones.sortOrder) }).from(milestones).where(eq(milestones.projectId, projectId));
    const [row] = await this.db
      .insert(milestones)
      .values({ projectId, name, description: input.description ?? null, targetDate: input.targetDate ?? null, status: input.status ?? 'planned', sortOrder: (m?.m ?? 0) + 1000 })
      .returning();
    if (!row) throw new Error('milestone insert failed');
    await publish(this.db, 'project.updated', { projectId, changedFields: ['milestones'], actor: toActorRef(actor) });
    return row;
  }

  async updateMilestone(
    actor: ServiceActor,
    id: string,
    patch: { name?: string | null; description?: string | null; targetDate?: string | null; status?: MilestoneStatus | null },
  ): Promise<MilestoneRow> {
    assertCan(actor, 'project.write');
    checkDate(patch.targetDate, 'targetDate');
    const set: Partial<typeof milestones.$inferInsert> = {};
    if (patch.name != null) {
      const n = patch.name.trim();
      if (!n || n.length > 80) throw validation('Milestone names are 1–80 characters.', { field: 'name' });
      set.name = n;
    }
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.targetDate !== undefined) set.targetDate = patch.targetDate;
    if (patch.status) set.status = patch.status;
    const [row] = await this.db.update(milestones).set(set).where(eq(milestones.id, id)).returning();
    if (!row) throw notFound('Milestone');
    await publish(this.db, 'project.updated', { projectId: row.projectId, changedFields: ['milestones'], actor: toActorRef(actor) });
    return row;
  }

  async reorderMilestone(actor: ServiceActor, id: string, beforeId: string | null, afterId: string | null): Promise<MilestoneRow> {
    assertCan(actor, 'project.write');
    const ids = [beforeId, afterId].filter((x): x is string => Boolean(x));
    const n = ids.length ? await this.db.select().from(milestones).where(inArray(milestones.id, ids)) : [];
    const [row] = await this.db
      .update(milestones)
      .set({ sortOrder: orderBetween(n.find((x) => x.id === beforeId)?.sortOrder ?? null, n.find((x) => x.id === afterId)?.sortOrder ?? null) })
      .where(eq(milestones.id, id))
      .returning();
    if (!row) throw notFound('Milestone');
    return row;
  }

  async deleteMilestone(actor: ServiceActor, id: string): Promise<void> {
    assertCan(actor, 'project.write');
    const [row] = await this.db.delete(milestones).where(eq(milestones.id, id)).returning();
    if (!row) throw notFound('Milestone');
    await publish(this.db, 'project.updated', { projectId: row.projectId, changedFields: ['milestones'], actor: toActorRef(actor) });
  }
}
