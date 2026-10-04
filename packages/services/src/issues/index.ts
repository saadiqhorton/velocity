import { and, asc, desc, eq, inArray, isNotNull, isNull, min, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  attachments,
  comments,
  cycleHistory,
  cycles,
  githubLinks,
  issueActivity,
  issueLabels,
  issueRelations,
  issues,
  labels,
  milestones,
  notifications,
  projects,
  statuses,
  subscriptions,
  teamCounters,
  teams,
  users,
} from '@velocity/schema';
import type { FilterOrder, FilterQuery, RelationType, StatusCategory } from '@velocity/schema';
import { MAX_ESTIMATE, MAX_LABELS_PER_ISSUE, MAX_SUB_ISSUE_DEPTH } from '@velocity/schema';
import { publish } from '@velocity/events';
import type { FieldChange } from '@velocity/events';
import { alias } from 'drizzle-orm/pg-core';
import { ServiceBase } from '../base';
import type { AuditService } from '../audit';
import type { ServiceActor } from '../context';
import { actorUserId, toActorRef } from '../context';
import type { DbOrTx, Tx } from '../db';
import { ServiceError, conflict, isUniqueViolation, notFound, validation } from '../errors';
import { orderBetween, needsRebalance } from '../lib/fractional-order';
import { parseIdentifier } from '../lib/identifiers';
import { sanitizeMarkdown } from '../lib/markdown';
import { assertCan } from '../lib/permissions';
import { recomputeProjectProgress } from '../projects';
import type { TeamService } from '../teams';
import { compileFilter, displayOrdering, groupOrder, orderSql } from './filter-sql';
import type { GroupBy } from './filter-sql';

export type IssueRow = typeof issues.$inferSelect;
export type RelationRow = typeof issueRelations.$inferSelect;

export interface IssueCreateInput {
  /** Client-minted UUID for optimistic create (SPEC §5.4). */
  id?: string | null;
  teamId: string;
  title: string;
  descriptionMd?: string | null;
  statusId?: string | null;
  assigneeId?: string | null;
  priority?: number | null;
  estimate?: number | null;
  labelIds?: string[] | null;
  projectId?: string | null;
  milestoneId?: string | null;
  cycleId?: string | null;
  parentId?: string | null;
  sortOrder?: number | null;
  /** Import-only overrides (ImporterService). */
  createdAt?: Date | null;
  completedAt?: Date | null;
  canceledAt?: Date | null;
  archivedAt?: Date | null;
  createdBy?: string | null;
}

export interface IssuePatch {
  title?: string | null;
  descriptionMd?: string | null;
  statusId?: string | null;
  assigneeId?: string | null;
  priority?: number | null;
  estimate?: number | null;
  labelIds?: string[] | null;
  addLabelIds?: string[] | null;
  removeLabelIds?: string[] | null;
  projectId?: string | null;
  milestoneId?: string | null;
  cycleId?: string | null;
  parentId?: string | null;
  sortOrder?: number | null;
}

export interface IssueListArgs {
  filter?: FilterQuery | null;
  /** Extra scoping that the UI applies outside the DSL. */
  teamId?: string | null;
  projectId?: string | null;
  cycleId?: string | null;
  milestoneId?: string | null;
  subscribedBy?: string | null;
  parentId?: string | null;
  groupBy?: GroupBy | null;
  /** Display ordering name; ignored when the filter has an `order:` clause. */
  ordering?: string | null;
  includeArchived?: boolean | null;
  includeSubIssues?: boolean | null;
  includeTrashed?: boolean | null;
  onlyTrashed?: boolean | null;
  first?: number | null;
  offset?: number | null;
}

export interface IssueListResult {
  nodes: IssueRow[];
  /** Lazily-computed total matching rows (memoized). Await only when the count is actually needed. */
  totalCount: () => Promise<number>;
  hasNextPage: boolean;
  offset: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Columns that are compared/emitted as field-level changes. */
const TRACKED: (keyof IssueRow)[] = [
  'title',
  'descriptionMd',
  'statusId',
  'assigneeId',
  'priority',
  'estimate',
  'projectId',
  'milestoneId',
  'cycleId',
  'parentId',
];

/** Field name → activity type (SPEC §3.5.1: every change emits activity). */
const ACTIVITY_TYPE: Partial<Record<keyof IssueRow, string>> = {
  title: 'title',
  descriptionMd: 'description',
  statusId: 'status',
  assigneeId: 'assignee',
  priority: 'priority',
  estimate: 'estimate',
  projectId: 'project',
  milestoneId: 'milestone',
  cycleId: 'cycle',
  parentId: 'parent',
};

function cleanTitle(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length < 1 || t.length > 512) throw validation('Titles are 1–512 characters.', { field: 'title' });
  return t;
}

function checkPriority(p: number): number {
  if (!Number.isInteger(p) || p < 0 || p > 4) throw validation('Priority must be 0 (Urgent) to 4 (No priority).', { field: 'priority' });
  return p;
}

function checkEstimate(e: number | null): number | null {
  if (e === null) return null;
  if (!Number.isInteger(e) || e < 0 || e > MAX_ESTIMATE) throw validation(`Estimates are whole numbers from 0 to ${MAX_ESTIMATE}.`, { field: 'estimate' });
  return e;
}

/** Category transitions stamp lifecycle timestamps (SPEC §3.6). */
function lifecycleStamps(from: StatusCategory | null, to: StatusCategory, current: Pick<IssueRow, 'startedAt'>, now: Date) {
  const out: Partial<IssueRow> = {};
  if (from === to) return out;
  if (to === 'done') Object.assign(out, { completedAt: now, canceledAt: null });
  else if (to === 'canceled') Object.assign(out, { canceledAt: now, completedAt: null });
  else Object.assign(out, { completedAt: null, canceledAt: null });
  if ((to === 'in_progress' || to === 'done') && !current.startedAt) out.startedAt = now;
  if (to === 'backlog' || to === 'todo') out.startedAt = null;
  return out;
}

export class IssueService extends ServiceBase {
  private teamService!: TeamService;
  private audit!: AuditService;

  bind(teamService: TeamService, audit: AuditService): void {
    this.teamService = teamService;
    this.audit = audit;
  }

  // ───────────── Reads ─────────────

  async get(id: string, executor: DbOrTx = this.db): Promise<IssueRow | null> {
    if (!UUID_RE.test(id)) return null;
    const [row] = await executor.select().from(issues).where(eq(issues.id, id));
    return row ?? null;
  }

  async getMany(ids: readonly string[]): Promise<IssueRow[]> {
    const valid = ids.filter((i) => UUID_RE.test(i));
    if (!valid.length) return [];
    return this.db.select().from(issues).where(inArray(issues.id, valid));
  }

  /** `ENG-123` (case-insensitive). Follows moved-pointers unless `followMoves` is false. */
  async getByIdentifier(identifier: string, opts: { followMoves?: boolean } = {}): Promise<IssueRow | null> {
    const parsed = parseIdentifier(identifier.trim());
    if (!parsed) return null;
    const [row] = await this.db
      .select({ issue: issues })
      .from(issues)
      .innerJoin(teams, eq(teams.id, issues.teamId))
      .where(and(eq(teams.key, parsed.teamKey), eq(issues.number, parsed.number)));
    let issue: IssueRow | null = row?.issue ?? null;
    let hops = 0;
    while (issue?.movedToIssueId && opts.followMoves !== false && hops++ < 10) {
      issue = await this.get(issue.movedToIssueId);
    }
    return issue;
  }

  /** Accepts a UUID or an identifier. */
  async resolve(idOrIdentifier: string): Promise<IssueRow | null> {
    return UUID_RE.test(idOrIdentifier) ? this.get(idOrIdentifier) : this.getByIdentifier(idOrIdentifier);
  }

  async require(idOrIdentifier: string): Promise<IssueRow> {
    const i = await this.resolve(idOrIdentifier);
    if (!i) throw notFound('Issue');
    return i;
  }

  async identifierOf(issue: Pick<IssueRow, 'teamId' | 'number'>, executor: DbOrTx = this.db): Promise<string> {
    const [t] = await executor.select({ key: teams.key }).from(teams).where(eq(teams.id, issue.teamId));
    return `${t?.key ?? '?'}-${issue.number}`;
  }

  async list(actor: ServiceActor, args: IssueListArgs): Promise<IssueListResult> {
    assertCan(actor, 'issue.read');
    const where = this.listWhere(actor, args);
    const first = Math.min(Math.max(args.first ?? 100, 1), 1000);
    const offset = Math.max(args.offset ?? 0, 0);
    const order: FilterOrder[] = args.filter?.order?.length ? args.filter.order : displayOrdering(args.ordering);
    const assignee = alias(users, 'assignee');
    const project = alias(projects, 'project');
    const cycle = alias(cycles, 'cycle');

    const orderBy = [...groupOrder(args.groupBy), ...orderSql(order), sql`issues.created_at desc`, sql`issues.id`];
    // Most list sorts reference only issue columns. Avoid planning five joins
    // on every keystroke/filter refresh unless a group or sort needs them.
    const needsJoins = ['status', 'assignee', 'project', 'cycle', 'team'].includes(args.groupBy ?? '') || order.some(o => o.field === 'status' || o.field === 'identifier');
    const query = needsJoins ? this.db
      .select({ issue: issues })
      .from(issues)
      .innerJoin(statuses, eq(statuses.id, issues.statusId))
      .innerJoin(teams, eq(teams.id, issues.teamId))
      .leftJoin(assignee, eq(assignee.id, issues.assigneeId))
      .leftJoin(project, eq(project.id, issues.projectId))
      .leftJoin(cycle, eq(cycle.id, issues.cycleId))
      : this.db.select({ issue: issues }).from(issues);
    const rows = await query
      .where(where)
      .orderBy(...orderBy)
      .limit(first + 1)
      .offset(offset);
    const hasNextPage = rows.length > first;
    let counted: Promise<number> | null = null;
    const totalCount = () =>
      (counted ??= this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(issues)
        .where(where)
        .then(([c]) => c?.n ?? 0));
    return { nodes: rows.slice(0, first).map((r) => r.issue), totalCount, hasNextPage, offset };
  }

  /** Counts per group key for list headers (SPEC §4.10.2 status group headers). */
  async groupCounts(actor: ServiceActor, args: IssueListArgs & { groupBy: GroupBy }): Promise<{ key: string | null; count: number }[]> {
    assertCan(actor, 'issue.read');
    const where = this.listWhere(actor, args);
    const keyExpr: SQL | null = {
      status: sql`issues.status_id::text`,
      assignee: sql`issues.assignee_id::text`,
      priority: sql`issues.priority::text`,
      project: sql`issues.project_id::text`,
      cycle: sql`issues.cycle_id::text`,
      team: sql`issues.team_id::text`,
      label: null,
      none: null,
    }[args.groupBy];
    if (args.groupBy === 'label') {
      const rows = await this.db
        .select({ key: sql<string | null>`il.label_id::text`, count: sql<number>`count(*)::int` })
        .from(issues)
        .leftJoin(sql`issue_labels il`, sql`il.issue_id = issues.id`)
        .where(where)
        .groupBy(sql`il.label_id`);
      return rows;
    }
    if (!keyExpr) {
      const [c] = await this.db.select({ n: sql<number>`count(*)::int` }).from(issues).where(where);
      return [{ key: null, count: c?.n ?? 0 }];
    }
    return this.db
      .select({ key: sql<string | null>`${keyExpr}`, count: sql<number>`count(*)::int` })
      .from(issues)
      .where(where)
      .groupBy(keyExpr);
  }

  private listWhere(actor: ServiceActor, args: IssueListArgs): SQL | undefined {
    const conds: (SQL | undefined)[] = [
      isNull(issues.movedToIssueId),
      sql`issues.team_id in (select t.id from teams t where t.deleted_at is null)`,
    ];
    if (args.onlyTrashed) conds.push(isNotNull(issues.trashedAt));
    else if (!args.includeTrashed) conds.push(isNull(issues.trashedAt));
    if (!args.includeArchived && !args.onlyTrashed) conds.push(isNull(issues.archivedAt));
    if (args.includeSubIssues === false) conds.push(isNull(issues.parentId));
    if (args.teamId) conds.push(eq(issues.teamId, args.teamId));
    if (args.projectId) conds.push(eq(issues.projectId, args.projectId));
    if (args.cycleId) conds.push(eq(issues.cycleId, args.cycleId));
    if (args.milestoneId) conds.push(eq(issues.milestoneId, args.milestoneId));
    if (args.parentId) conds.push(eq(issues.parentId, args.parentId));
    if (args.subscribedBy) {
      conds.push(sql`exists (select 1 from subscriptions s where s.issue_id = issues.id and s.user_id = ${args.subscribedBy}::uuid)`);
    }
    conds.push(compileFilter(args.filter?.filter ?? null, { actorUserId: actorUserId(actor), now: this.now() }));
    return and(...conds.filter((c): c is SQL => Boolean(c)));
  }

  async children(parentId: string): Promise<IssueRow[]> {
    return this.db
      .select()
      .from(issues)
      .where(and(eq(issues.parentId, parentId), isNull(issues.trashedAt), isNull(issues.movedToIssueId)))
      .orderBy(asc(issues.sortOrder), asc(issues.number));
  }

  /** done/total sub-issue rollups for many parents at once (SPEC §3.5.2). */
  async rollups(parentIds: readonly string[]): Promise<Map<string, { done: number; total: number }>> {
    const out = new Map<string, { done: number; total: number }>();
    if (!parentIds.length) return out;
    const rows = await this.db
      .select({
        parentId: issues.parentId,
        total: sql<number>`count(*) filter (where ${statuses.category} <> 'canceled')::int`,
        done: sql<number>`count(*) filter (where ${statuses.category} = 'done')::int`,
      })
      .from(issues)
      .innerJoin(statuses, eq(statuses.id, issues.statusId))
      .where(and(inArray(issues.parentId, [...parentIds]), isNull(issues.trashedAt), isNull(issues.movedToIssueId)))
      .groupBy(issues.parentId);
    for (const r of rows) if (r.parentId) out.set(r.parentId, { done: r.done, total: r.total });
    return out;
  }

  async labelIdsFor(issueIds: readonly string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!issueIds.length) return out;
    const rows = await this.db.select().from(issueLabels).where(inArray(issueLabels.issueId, [...issueIds]));
    for (const r of rows) {
      const arr = out.get(r.issueId) ?? [];
      arr.push(r.labelId);
      out.set(r.issueId, arr);
    }
    return out;
  }

  async relationsFor(issueIds: readonly string[]): Promise<RelationRow[]> {
    if (!issueIds.length) return [];
    return this.db
      .select()
      .from(issueRelations)
      .where(or(inArray(issueRelations.sourceIssueId, [...issueIds]), inArray(issueRelations.targetIssueId, [...issueIds])));
  }

  async activity(issueId: string) {
    return this.db.select().from(issueActivity).where(eq(issueActivity.issueId, issueId)).orderBy(asc(issueActivity.createdAt));
  }

  // ───────────── Validation helpers ─────────────

  private async validateRefs(
    tx: Tx,
    teamId: string,
    v: { statusId?: string | null; assigneeId?: string | null; labelIds?: string[] | null; projectId?: string | null; milestoneId?: string | null; cycleId?: string | null },
    allowClosedCycle = false,
  ): Promise<{ status?: typeof statuses.$inferSelect; milestoneProjectId?: string | null }> {
    const out: { status?: typeof statuses.$inferSelect; milestoneProjectId?: string | null } = {};
    if (v.statusId) {
      const [s] = await tx.select().from(statuses).where(eq(statuses.id, v.statusId));
      if (!s || s.archivedAt) throw notFound('Status');
      if (s.teamId !== teamId) throw validation('That status belongs to a different team.', { field: 'statusId' });
      out.status = s;
    }
    if (v.assigneeId) {
      const [u] = await tx.select().from(users).where(eq(users.id, v.assigneeId));
      if (!u || u.deletedAt) throw notFound('Assignee');
      if (u.suspendedAt) throw validation('That member is suspended.', { field: 'assigneeId' });
    }
    if (v.labelIds) {
      if (v.labelIds.length > MAX_LABELS_PER_ISSUE) throw validation(`An issue can have at most ${MAX_LABELS_PER_ISSUE} labels.`, { field: 'labelIds' });
      if (v.labelIds.length) {
        const ls = await tx.select().from(labels).where(inArray(labels.id, v.labelIds));
        if (ls.length !== new Set(v.labelIds).size) throw notFound('Label');
        if (ls.some((l) => l.isGroup)) throw validation('Label groups can’t be applied to issues; pick a label inside the group.', { field: 'labelIds' });
        if (ls.some((l) => l.archivedAt)) throw validation('That label is archived.', { field: 'labelIds' });
      }
    }
    if (v.projectId) {
      const [p] = await tx.select().from(projects).where(eq(projects.id, v.projectId));
      if (!p || p.trashedAt) throw notFound('Project');
    }
    if (v.milestoneId) {
      const [m] = await tx.select().from(milestones).where(eq(milestones.id, v.milestoneId));
      if (!m) throw notFound('Milestone');
      out.milestoneProjectId = m.projectId;
    }
    if (v.cycleId) {
      const [c] = await tx.select().from(cycles).where(eq(cycles.id, v.cycleId));
      if (!c) throw notFound('Cycle');
      if (c.teamId !== teamId) throw validation('That cycle belongs to a different team.', { field: 'cycleId' });
      if (c.closedAt && !allowClosedCycle) throw validation('That cycle is closed.', { field: 'cycleId' });
    }
    return out;
  }

  /** Level of an issue = 1 + number of ancestors. Also reports whether `probeId` is on the chain. */
  private async chainInfo(tx: DbOrTx, issueId: string, probeId: string | null): Promise<{ level: number; containsProbe: boolean }> {
    const res = await tx.execute<{ level: number; contains: boolean }>(sql`
      with recursive up as (
        select id, parent_id, 1 as lvl from issues where id = ${issueId}
        union all
        select i.id, i.parent_id, up.lvl + 1 from issues i join up on i.id = up.parent_id where up.lvl < 64
      )
      select max(lvl)::int as level, coalesce(bool_or(id = ${probeId}::uuid), false) as contains from up`);
    const row = res.rows[0];
    return { level: row?.level ?? 1, containsProbe: Boolean(row?.contains) };
  }

  private async subtreeHeight(tx: DbOrTx, issueId: string): Promise<number> {
    const res = await tx.execute<{ h: number }>(sql`
      with recursive down as (
        select id, 1 as h from issues where id = ${issueId}
        union all
        select i.id, d.h + 1 from issues i join down d on i.parent_id = d.id where d.h < 64
      )
      select max(h)::int as h from down`);
    return res.rows[0]?.h ?? 1;
  }

  /** SPEC §3.5.2: tree depth ≤ 5 levels; no cycles. */
  private async assertParent(tx: Tx, issueId: string | null, parentId: string, teamId: string): Promise<void> {
    const parent = await this.get(parentId, tx);
    if (!parent || parent.trashedAt || parent.movedToIssueId) throw notFound('Parent issue');
    if (issueId && parentId === issueId) throw validation('An issue can’t be its own parent.', { field: 'parentId' });
    void teamId;
    const chain = await this.chainInfo(tx, parentId, issueId);
    if (chain.containsProbe) throw validation('That would create a loop of sub-issues.', { field: 'parentId' });
    const height = issueId ? await this.subtreeHeight(tx, issueId) : 1;
    if (chain.level + height > MAX_SUB_ISSUE_DEPTH) {
      throw validation(`Sub-issues can be nested at most ${MAX_SUB_ISSUE_DEPTH} levels deep.`, { field: 'parentId' });
    }
  }

  // ───────────── Create ─────────────

  async create(actor: ServiceActor, input: IssueCreateInput): Promise<IssueRow> {
    assertCan(actor, 'issue.write');
    return this.tx((tx) => this.createInTx(tx, actor, input));
  }

  async createInTx(tx: Tx, actor: ServiceActor, input: IssueCreateInput): Promise<IssueRow> {
    assertCan(actor, 'issue.write');
    const team = await this.teamService.require(input.teamId, tx);
    if (team.archivedAt) throw validation('That team is archived.', { field: 'teamId' });
    const title = cleanTitle(input.title);
    const priority = checkPriority(input.priority ?? 2);
    const estimate = checkEstimate(input.estimate ?? null);
    const labelIds = [...new Set(input.labelIds ?? [])];
    const refs = await this.validateRefs(tx, team.id, {
      statusId: input.statusId,
      assigneeId: input.assigneeId,
      labelIds,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      cycleId: input.cycleId,
    }, actor.kind === 'import');
    let projectId = input.projectId ?? null;
    if (input.milestoneId) {
      if (projectId && refs.milestoneProjectId !== projectId) throw validation('That milestone belongs to a different project.', { field: 'milestoneId' });
      projectId = refs.milestoneProjectId ?? projectId;
    }
    if (input.parentId) await this.assertParent(tx, null, input.parentId, team.id);
    const status = refs.status ?? (await this.teamService.defaultStatus(team.id, tx));
    if (input.id && !UUID_RE.test(input.id)) throw validation('Invalid client id.', { field: 'id' });

    // Gapless per-team numbering: the UPDATE row-locks the counter until commit (SPEC §5.11).
    const counter = await tx
      .update(teamCounters)
      .set({ nextNumber: sql`${teamCounters.nextNumber} + 1` })
      .where(eq(teamCounters.teamId, team.id))
      .returning({ next: teamCounters.nextNumber });
    const number = (counter[0]?.next ?? 1) - 1;
    if (!counter[0]) throw new Error('team counter missing');

    let sortOrder = input.sortOrder ?? null;
    if (sortOrder == null) {
      const [m] = await tx.select({ m: min(issues.sortOrder) }).from(issues).where(eq(issues.teamId, team.id));
      sortOrder = (m?.m ?? 0) - 1000;
    }
    const now = input.createdAt ?? this.now();
    const stamps = lifecycleStamps(null, status.category, { startedAt: null }, now);
    let row: IssueRow | undefined;
    try {
      [row] = await tx
        .insert(issues)
        .values({
          ...(input.id ? { id: input.id } : {}),
          teamId: team.id,
          number,
          title,
          descriptionMd: sanitizeMarkdown(input.descriptionMd ?? ''),
          statusId: status.id,
          assigneeId: input.assigneeId ?? null,
          priority,
          estimate,
          sortOrder,
          parentId: input.parentId ?? null,
          projectId,
          milestoneId: input.milestoneId ?? null,
          cycleId: input.cycleId ?? null,
          createdBy: input.createdBy !== undefined ? input.createdBy : actorUserId(actor),
          createdAt: now,
          updatedAt: now,
          ...stamps,
          ...(input.completedAt !== undefined && input.completedAt !== null ? { completedAt: input.completedAt } : {}),
          ...(input.canceledAt ? { canceledAt: input.canceledAt } : {}),
          archivedAt: input.archivedAt ?? null,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, 'issues_pkey')) throw conflict('An issue with that id already exists.');
      throw err;
    }
    if (!row) throw new Error('issue insert failed');
    if (labelIds.length) await tx.insert(issueLabels).values(labelIds.map((labelId) => ({ issueId: row!.id, labelId })));
    if (row.cycleId) await tx.insert(cycleHistory).values({ cycleId: row.cycleId, issueId: row.id, addedAt: now });
    await tx.insert(issueActivity).values({ issueId: row.id, actorUserId: actorUserId(actor), actorKind: actor.kind, type: 'created', createdAt: now });
    const subscribers = new Set([actorUserId(actor), row.assigneeId].filter((x): x is string => Boolean(x)));
    if (subscribers.size) {
      await tx.insert(subscriptions).values([...subscribers].map((userId) => ({ issueId: row!.id, userId }))).onConflictDoNothing();
    }
    if (projectId) await recomputeProjectProgress(tx, [projectId]);
    await publish(tx, 'issue.created', { issueId: row.id, teamId: team.id, identifier: `${team.key}-${number}`, actor: toActorRef(actor) });
    return row;
  }

  // ───────────── Update ─────────────

  async update(actor: ServiceActor, idOrIdentifier: string, patch: IssuePatch, opts: { expectedUpdatedAt?: Date | null } = {}): Promise<IssueRow> {
    assertCan(actor, 'issue.write');
    const existing = await this.require(idOrIdentifier);
    return this.tx((tx) => this.updateInTx(tx, actor, existing.id, patch, opts));
  }

  async updateInTx(tx: Tx, actor: ServiceActor, id: string, patch: IssuePatch, opts: { expectedUpdatedAt?: Date | null } = {}): Promise<IssueRow> {
    assertCan(actor, 'issue.write');
    const [current] = await tx.select().from(issues).where(eq(issues.id, id)).for('update');
    if (!current) throw notFound('Issue');
    if (current.movedToIssueId) throw validation('This issue was moved to another team. Edit the new issue instead.');
    if (opts.expectedUpdatedAt && current.updatedAt.getTime() !== new Date(opts.expectedUpdatedAt).getTime()) {
      throw conflict('This issue was changed by someone else. Reload and try again.', { updatedAt: current.updatedAt.toISOString() });
    }
    const now = this.now();
    const set: Partial<IssueRow> = {};

    if (patch.title != null) set.title = cleanTitle(patch.title);
    if (patch.descriptionMd != null) set.descriptionMd = sanitizeMarkdown(patch.descriptionMd);
    if (patch.priority != null) set.priority = checkPriority(patch.priority);
    if (patch.estimate !== undefined) set.estimate = checkEstimate(patch.estimate);
    if (patch.assigneeId !== undefined) set.assigneeId = patch.assigneeId;
    if (patch.statusId) set.statusId = patch.statusId;
    if (patch.projectId !== undefined) set.projectId = patch.projectId;
    if (patch.milestoneId !== undefined) set.milestoneId = patch.milestoneId;
    if (patch.cycleId !== undefined) set.cycleId = patch.cycleId;
    if (patch.parentId !== undefined) set.parentId = patch.parentId;
    if (patch.sortOrder != null) set.sortOrder = patch.sortOrder;

    // Labels: full replacement or add/remove deltas (bulk ops).
    const currentLabels = (await tx.select().from(issueLabels).where(eq(issueLabels.issueId, id))).map((r) => r.labelId);
    let nextLabels: string[] | null = null;
    if (patch.labelIds) nextLabels = [...new Set(patch.labelIds)];
    if (patch.addLabelIds?.length || patch.removeLabelIds?.length) {
      const s = new Set(nextLabels ?? currentLabels);
      for (const l of patch.addLabelIds ?? []) s.add(l);
      for (const l of patch.removeLabelIds ?? []) s.delete(l);
      nextLabels = [...s];
    }

    const refs = await this.validateRefs(tx, current.teamId, {
      statusId: set.statusId !== current.statusId ? set.statusId : undefined,
      assigneeId: set.assigneeId !== current.assigneeId ? set.assigneeId : undefined,
      labelIds: nextLabels,
      projectId: set.projectId !== current.projectId ? set.projectId : undefined,
      milestoneId: set.milestoneId !== current.milestoneId ? set.milestoneId : undefined,
      cycleId: set.cycleId !== current.cycleId ? set.cycleId : undefined,
    });

    // Milestone ↔ project consistency.
    const nextProject = set.projectId !== undefined ? set.projectId : current.projectId;
    if (set.milestoneId) {
      if (nextProject && refs.milestoneProjectId && refs.milestoneProjectId !== nextProject) {
        if (patch.projectId !== undefined) throw validation('That milestone belongs to a different project.', { field: 'milestoneId' });
      }
      if (refs.milestoneProjectId && refs.milestoneProjectId !== nextProject) set.projectId = refs.milestoneProjectId;
    } else if (set.projectId !== undefined && set.projectId !== current.projectId && current.milestoneId && set.milestoneId === undefined) {
      set.milestoneId = null;
    }

    if (set.parentId && set.parentId !== current.parentId) await this.assertParent(tx, id, set.parentId, current.teamId);

    // Status category transitions.
    if (set.statusId && set.statusId !== current.statusId) {
      const [fromStatus] = await tx.select().from(statuses).where(eq(statuses.id, current.statusId));
      const toStatus = refs.status ?? (await this.teamService.getStatus(set.statusId, tx));
      if (!toStatus) throw notFound('Status');
      Object.assign(set, lifecycleStamps(fromStatus?.category ?? null, toStatus.category, current, now));
    }

    // Field-level diff.
    const changes: Record<string, FieldChange> = {};
    for (const k of TRACKED) {
      if (!(k in set)) continue;
      const before = current[k];
      const after = set[k as keyof typeof set];
      if (before === after) {
        delete set[k as keyof typeof set];
        continue;
      }
      changes[k] = k === 'descriptionMd' ? { from: null, to: null } : { from: before ?? null, to: after ?? null };
    }
    const labelsChanged =
      nextLabels !== null && (nextLabels.length !== currentLabels.length || nextLabels.some((l) => !currentLabels.includes(l)));
    if (labelsChanged) changes.labelIds = { from: currentLabels, to: nextLabels };
    const sortChanged = set.sortOrder !== undefined && set.sortOrder !== current.sortOrder;

    if (!Object.keys(changes).length && !sortChanged) return current;

    const [updated] = await tx
      .update(issues)
      .set({ ...set, updatedAt: now })
      .where(eq(issues.id, id))
      .returning();
    if (!updated) throw notFound('Issue');

    if (labelsChanged && nextLabels) {
      const add = nextLabels.filter((l) => !currentLabels.includes(l));
      const remove = currentLabels.filter((l) => !nextLabels!.includes(l));
      if (remove.length) await tx.delete(issueLabels).where(and(eq(issueLabels.issueId, id), inArray(issueLabels.labelId, remove)));
      if (add.length) await tx.insert(issueLabels).values(add.map((labelId) => ({ issueId: id, labelId }))).onConflictDoNothing();
    }

    // Cycle scope history (SPEC §3.8 "added after start" markers).
    if (changes.cycleId) {
      if (current.cycleId) {
        await tx
          .update(cycleHistory)
          .set({ removedAt: now })
          .where(and(eq(cycleHistory.cycleId, current.cycleId), eq(cycleHistory.issueId, id), isNull(cycleHistory.removedAt)));
      }
      if (updated.cycleId) await tx.insert(cycleHistory).values({ cycleId: updated.cycleId, issueId: id, addedAt: now });
    }

    // Activity rows.
    const activity = Object.entries(changes)
      .map(([field, ch]) => ({
        issueId: id,
        actorUserId: actorUserId(actor),
        actorKind: actor.kind,
        type: field === 'labelIds' ? 'labels' : (ACTIVITY_TYPE[field as keyof IssueRow] ?? field),
        fromValue: ch.from as unknown,
        toValue: ch.to as unknown,
        createdAt: now,
      }));
    if (activity.length) await tx.insert(issueActivity).values(activity);

    if (changes.assigneeId && updated.assigneeId) {
      await tx.insert(subscriptions).values({ issueId: id, userId: updated.assigneeId }).onConflictDoNothing();
    }

    const affectedProjects = new Set<string>();
    if (changes.projectId || changes.statusId || changes.estimate) {
      if (current.projectId) affectedProjects.add(current.projectId);
      if (updated.projectId) affectedProjects.add(updated.projectId);
    }
    if (affectedProjects.size) await recomputeProjectProgress(tx, [...affectedProjects]);

    if (Object.keys(changes).length) {
      const identifier = await this.identifierOf(updated, tx);
      await publish(tx, 'issue.updated', {
        issueId: id,
        teamId: updated.teamId,
        identifier,
        changedFields: Object.keys(changes),
        changes,
        actor: toActorRef(actor),
      });
    } else if (sortChanged) {
      await publish(tx, 'issue.updated', {
        issueId: id,
        teamId: updated.teamId,
        identifier: await this.identifierOf(updated, tx),
        changedFields: ['sortOrder'],
        changes: {},
        actor: toActorRef(actor),
      });
    }
    return updated;
  }

  /** Bulk ops (SPEC §3.5.1): one transaction, per-issue events/activity. */
  async bulkUpdate(actor: ServiceActor, ids: string[], patch: IssuePatch): Promise<IssueRow[]> {
    assertCan(actor, 'issue.write');
    if (ids.length > 500) throw validation('Bulk edits are limited to 500 issues at a time.');
    return this.tx(async (tx) => {
      const out: IssueRow[] = [];
      for (const id of ids) {
        const issue = await this.get(id, tx);
        if (!issue) throw notFound('Issue');
        let p = patch;
        // A status id is team-specific: map it by name/category for issues of other teams.
        if (patch.statusId) {
          const target = await this.teamService.getStatus(patch.statusId, tx);
          if (target && target.teamId !== issue.teamId) {
            const mapped =
              (await this.teamService.statusByName(issue.teamId, target.name, tx)) ??
              (await this.teamService.firstStatusOfCategory(issue.teamId, target.category, tx));
            p = { ...patch, statusId: mapped?.id ?? null };
          }
        }
        if (patch.cycleId) {
          const [c] = await tx.select().from(cycles).where(eq(cycles.id, patch.cycleId));
          if (c && c.teamId !== issue.teamId) p = { ...p, cycleId: undefined };
        }
        out.push(await this.updateInTx(tx, actor, id, p));
      }
      return out;
    });
  }

  /** Mark done toggle (`E`): done ↔ first todo status. */
  async toggleDone(actor: ServiceActor, id: string): Promise<IssueRow> {
    const issue = await this.require(id);
    const status = await this.teamService.getStatus(issue.statusId);
    const target =
      status?.category === 'done'
        ? ((await this.teamService.firstStatusOfCategory(issue.teamId, 'todo')) ?? (await this.teamService.defaultStatus(issue.teamId)))
        : await this.teamService.firstStatusOfCategory(issue.teamId, 'done');
    if (!target) throw validation('This team has no Done status.');
    return this.update(actor, issue.id, { statusId: target.id });
  }

  // ───────────── Ordering (SPEC §4.12 ⌥↑/↓, board DnD) ─────────────

  async reorder(actor: ServiceActor, id: string, beforeId: string | null, afterId: string | null): Promise<IssueRow> {
    assertCan(actor, 'issue.write');
    return this.tx(async (tx) => {
      const issue = await this.get(id, tx);
      if (!issue) throw notFound('Issue');
      const neighbours = [beforeId, afterId].filter((x): x is string => Boolean(x));
      const rows = neighbours.length ? await tx.select().from(issues).where(inArray(issues.id, neighbours)) : [];
      let before = rows.find((r) => r.id === beforeId)?.sortOrder ?? null;
      let after = rows.find((r) => r.id === afterId)?.sortOrder ?? null;
      if (before !== null && after !== null && before > after) [before, after] = [after, before];
      if (needsRebalance(before, after)) {
        await tx.execute(sql`
          update issues set sort_order = r.rn * 1000
          from (select id, row_number() over (order by sort_order, created_at) as rn from issues where team_id = ${issue.teamId}) r
          where issues.id = r.id`);
        const re = neighbours.length ? await tx.select().from(issues).where(inArray(issues.id, neighbours)) : [];
        before = re.find((r) => r.id === beforeId)?.sortOrder ?? null;
        after = re.find((r) => r.id === afterId)?.sortOrder ?? null;
        if (before !== null && after !== null && before > after) [before, after] = [after, before];
      }
      return this.updateInTx(tx, actor, id, { sortOrder: orderBetween(before, after) });
    });
  }

  // ───────────── Archive / trash (SPEC §3.5.1) ─────────────

  async setArchived(actor: ServiceActor, ids: string[], archived: boolean): Promise<IssueRow[]> {
    assertCan(actor, 'issue.write');
    return this.tx(async (tx) => {
      const out: IssueRow[] = [];
      for (const id of ids) {
        const [row] = await tx
          .update(issues)
          .set({ archivedAt: archived ? this.now() : null, updatedAt: this.now() })
          .where(eq(issues.id, id))
          .returning();
        if (!row) throw notFound('Issue');
        await tx.insert(issueActivity).values({ issueId: id, actorUserId: actorUserId(actor), actorKind: actor.kind, type: archived ? 'archived' : 'unarchived' });
        await publish(tx, 'issue.archived', { issueId: id, teamId: row.teamId, archived, actor: toActorRef(actor) });
        if (row.projectId) await recomputeProjectProgress(tx, [row.projectId]);
        out.push(row);
      }
      return out;
    });
  }

  async setTrashed(actor: ServiceActor, ids: string[], trashed: boolean): Promise<IssueRow[]> {
    assertCan(actor, 'issue.write');
    return this.tx(async (tx) => {
      const out: IssueRow[] = [];
      for (const id of ids) {
        const [row] = await tx
          .update(issues)
          .set({ trashedAt: trashed ? this.now() : null, updatedAt: this.now() })
          .where(eq(issues.id, id))
          .returning();
        if (!row) throw notFound('Issue');
        await tx.insert(issueActivity).values({ issueId: id, actorUserId: actorUserId(actor), actorKind: actor.kind, type: trashed ? 'trashed' : 'restored' });
        await publish(tx, 'issue.trashed', { issueId: id, teamId: row.teamId, trashed, actor: toActorRef(actor) });
        if (row.projectId) await recomputeProjectProgress(tx, [row.projectId]);
        out.push(row);
      }
      return out;
    });
  }

  /** Permanent delete (trash purge or explicit "delete forever"). Attachment files are removed. */
  async deleteForever(actor: ServiceActor, id: string): Promise<void> {
    assertCan(actor, 'issue.write');
    const issue = await this.get(id);
    if (!issue) throw notFound('Issue');
    const files = await this.db.select({ path: attachments.storagePath }).from(attachments).where(eq(attachments.issueId, id));
    await this.tx(async (tx) => {
      const identifier = await this.identifierOf(issue, tx);
      await tx.update(issues).set({ movedToIssueId: null }).where(eq(issues.movedToIssueId, id));
      await tx.delete(issues).where(eq(issues.id, id));
      await this.audit.log(tx, actor, { action: 'issue.deleted', objectType: 'issue', objectId: id, changes: { identifier, title: issue.title } });
      await publish(tx, 'issue.deleted', { issueId: id, teamId: issue.teamId, actor: toActorRef(actor) });
      if (issue.projectId) await recomputeProjectProgress(tx, [issue.projectId]);
    });
    for (const f of files) await this.storage.delete(f.path).catch(() => {});
  }

  // ───────────── Move between teams (SPEC §3.5.1) ─────────────

  async move(actor: ServiceActor, id: string, targetTeamId: string, opts: { statusId?: string | null } = {}): Promise<IssueRow> {
    assertCan(actor, 'issue.write');
    return this.tx((tx) => this.moveInTx(tx, actor, id, targetTeamId, opts));
  }

  async moveAllFromTeam(actor: ServiceActor, fromTeamId: string, toTeamId: string): Promise<number> {
    const rows = await this.db
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.teamId, fromTeamId), isNull(issues.movedToIssueId)))
      .orderBy(asc(issues.number));
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await this.tx(async (tx) => {
        for (const r of chunk) await this.moveInTx(tx, actor, r.id, toTeamId, {});
      });
    }
    return rows.length;
  }

  private async moveInTx(tx: Tx, actor: ServiceActor, id: string, targetTeamId: string, opts: { statusId?: string | null }): Promise<IssueRow> {
    const [src] = await tx.select().from(issues).where(eq(issues.id, id)).for('update');
    if (!src) throw notFound('Issue');
    if (src.movedToIssueId) throw validation('This issue was already moved.');
    if (src.teamId === targetTeamId) return src;
    const target = await this.teamService.require(targetTeamId, tx);
    const [srcStatus] = await tx.select().from(statuses).where(eq(statuses.id, src.statusId));
    let statusId = opts.statusId ?? null;
    if (statusId) {
      const s = await this.teamService.getStatus(statusId, tx);
      if (!s || s.teamId !== target.id) throw validation('Pick a status from the target team.', { field: 'statusId' });
    } else {
      const byName = srcStatus ? await this.teamService.statusByName(target.id, srcStatus.name, tx) : null;
      const byCat = srcStatus ? await this.teamService.firstStatusOfCategory(target.id, srcStatus.category, tx) : null;
      statusId = (byName ?? byCat ?? (await this.teamService.defaultStatus(target.id, tx))).id;
    }
    const counter = await tx
      .update(teamCounters)
      .set({ nextNumber: sql`${teamCounters.nextNumber} + 1` })
      .where(eq(teamCounters.teamId, target.id))
      .returning({ next: teamCounters.nextNumber });
    const number = (counter[0]?.next ?? 1) - 1;
    const now = this.now();
    const rest = Object.fromEntries(
      Object.entries(src).filter(([key]) => !['id', 'number', 'teamId', 'searchVector', 'cycleId'].includes(key)),
    ) as Omit<typeof src, 'id' | 'number' | 'teamId' | 'searchVector' | 'cycleId'>;
    const [moved] = await tx
      .insert(issues)
      .values({ ...rest, teamId: target.id, number, statusId, cycleId: null, updatedAt: now })
      .returning();
    if (!moved) throw new Error('move insert failed');
    // Re-point owned/linked rows to the new issue.
    await tx.update(issueLabels).set({ issueId: moved.id }).where(eq(issueLabels.issueId, id));
    await tx.update(comments).set({ issueId: moved.id }).where(eq(comments.issueId, id));
    await tx.update(issueActivity).set({ issueId: moved.id }).where(eq(issueActivity.issueId, id));
    await tx.update(attachments).set({ issueId: moved.id }).where(eq(attachments.issueId, id));
    await tx.update(githubLinks).set({ issueId: moved.id }).where(eq(githubLinks.issueId, id));
    await tx.update(notifications).set({ issueId: moved.id }).where(eq(notifications.issueId, id));
    await tx.update(subscriptions).set({ issueId: moved.id }).where(eq(subscriptions.issueId, id));
    await tx.update(issueRelations).set({ sourceIssueId: moved.id }).where(eq(issueRelations.sourceIssueId, id));
    await tx.update(issueRelations).set({ targetIssueId: moved.id }).where(eq(issueRelations.targetIssueId, id));
    await tx.update(issues).set({ parentId: moved.id }).where(eq(issues.parentId, id));
    if (src.cycleId) {
      await tx.update(cycleHistory).set({ removedAt: now }).where(and(eq(cycleHistory.issueId, id), isNull(cycleHistory.removedAt)));
    }
    // The old row stays as a permanent moved-pointer (movedToIssueId), out of every view.
    await tx.update(issues).set({ movedToIssueId: moved.id, archivedAt: now, updatedAt: now }).where(eq(issues.id, id));
    const [srcTeam] = await tx.select({ key: teams.key }).from(teams).where(eq(teams.id, src.teamId));
    const oldIdentifier = `${srcTeam?.key}-${src.number}`;
    const newIdentifier = `${target.key}-${number}`;
    await tx.insert(issueActivity).values({
      issueId: moved.id,
      actorUserId: actorUserId(actor),
      actorKind: actor.kind,
      type: 'moved',
      fromValue: { identifier: oldIdentifier, teamId: src.teamId },
      toValue: { identifier: newIdentifier, teamId: target.id },
    });
    await publish(tx, 'issue.moved', { issueId: id, fromTeamId: src.teamId, toIssueId: moved.id, toTeamId: target.id, actor: toActorRef(actor) });
    await publish(tx, 'issue.created', { issueId: moved.id, teamId: target.id, identifier: newIdentifier, actor: toActorRef(actor) });
    return moved;
  }

  // ───────────── Duplicate (SPEC §3.5.1) ─────────────

  async duplicate(actor: ServiceActor, id: string): Promise<IssueRow> {
    assertCan(actor, 'issue.write');
    const src = await this.require(id);
    return this.tx(async (tx) => {
      const labelIds = (await tx.select().from(issueLabels).where(eq(issueLabels.issueId, src.id))).map((r) => r.labelId);
      const copy = await this.createInTx(tx, actor, {
        teamId: src.teamId,
        title: src.title,
        descriptionMd: src.descriptionMd,
        labelIds,
      });
      await this.addRelationInTx(tx, actor, copy.id, 'related', src.id);
      return copy;
    });
  }

  // ───────────── Relations (SPEC §3.5.3) ─────────────

  async addRelation(actor: ServiceActor, issueId: string, type: RelationType | 'blocked_by', targetId: string): Promise<RelationRow> {
    assertCan(actor, 'issue.write');
    return this.tx((tx) => this.addRelationInTx(tx, actor, issueId, type, targetId));
  }

  async addRelationInTx(tx: Tx, actor: ServiceActor, issueId: string, type: RelationType | 'blocked_by', targetId: string): Promise<RelationRow> {
    const a = await this.get(issueId, tx);
    const b = await this.get(targetId, tx);
    if (!a || !b) throw notFound('Issue');
    if (a.id === b.id) throw validation('An issue can’t be related to itself.');
    // blocked_by is the derived inverse of blocks: stored once (SPEC §5.11 invariant).
    const [source, target, stored] = type === 'blocked_by' ? [b, a, 'blocks' as const] : [a, b, type];
    try {
      const [row] = await tx
        .insert(issueRelations)
        .values({ sourceIssueId: source.id, targetIssueId: target.id, type: stored, createdBy: actorUserId(actor) })
        .returning();
      if (!row) throw new Error('relation insert failed');
      const now = this.now();
      await tx.insert(issueActivity).values([
        { issueId: source.id, actorUserId: actorUserId(actor), actorKind: actor.kind, type: 'relation_added', toValue: { type: stored, direction: 'out', issueId: target.id }, createdAt: now },
        { issueId: target.id, actorUserId: actorUserId(actor), actorKind: actor.kind, type: 'relation_added', toValue: { type: stored, direction: 'in', issueId: source.id }, createdAt: now },
      ]);
      await publish(tx, 'relation.created', { relationId: row.id, sourceIssueId: source.id, targetIssueId: target.id, type: stored, actor: toActorRef(actor) });
      return row;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('These issues are already related that way.');
      throw err;
    }
  }

  async removeRelation(actor: ServiceActor, relationId: string): Promise<void> {
    assertCan(actor, 'issue.write');
    await this.tx(async (tx) => {
      const [row] = await tx.delete(issueRelations).where(eq(issueRelations.id, relationId)).returning();
      if (!row) throw notFound('Relation');
      await tx.insert(issueActivity).values([
        { issueId: row.sourceIssueId, actorUserId: actorUserId(actor), actorKind: actor.kind, type: 'relation_removed', fromValue: { type: row.type, direction: 'out', issueId: row.targetIssueId } },
        { issueId: row.targetIssueId, actorUserId: actorUserId(actor), actorKind: actor.kind, type: 'relation_removed', fromValue: { type: row.type, direction: 'in', issueId: row.sourceIssueId } },
      ]);
      await publish(tx, 'relation.deleted', { relationId, sourceIssueId: row.sourceIssueId, targetIssueId: row.targetIssueId, actor: toActorRef(actor) });
    });
  }

  // ───────────── Subscriptions (SPEC §3.11) ─────────────

  async setSubscribed(actor: ServiceActor, issueId: string, subscribed: boolean): Promise<boolean> {
    assertCan(actor, 'issue.read');
    if (!actor.userId) throw new ServiceError('VALIDATION', 'Only members can subscribe.');
    const issue = await this.require(issueId);
    if (subscribed) await this.db.insert(subscriptions).values({ issueId: issue.id, userId: actor.userId }).onConflictDoNothing();
    else await this.db.delete(subscriptions).where(and(eq(subscriptions.issueId, issue.id), eq(subscriptions.userId, actor.userId)));
    return subscribed;
  }

  async subscriberIds(issueId: string, executor: DbOrTx = this.db): Promise<string[]> {
    const rows = await executor.select({ userId: subscriptions.userId }).from(subscriptions).where(eq(subscriptions.issueId, issueId));
    return rows.map((r) => r.userId);
  }

  async isSubscribed(issueIds: readonly string[], userId: string): Promise<Set<string>> {
    if (!issueIds.length || !userId) return new Set();
    const rows = await this.db
      .select({ issueId: subscriptions.issueId })
      .from(subscriptions)
      .where(and(inArray(subscriptions.issueId, [...issueIds]), eq(subscriptions.userId, userId)));
    return new Set(rows.map((r) => r.issueId));
  }

  // ───────────── Misc ─────────────

  async countByTeam(): Promise<{ teamId: string; open: number }[]> {
    return this.db
      .select({ teamId: issues.teamId, open: sql<number>`count(*)::int` })
      .from(issues)
      .innerJoin(statuses, eq(statuses.id, issues.statusId))
      .where(and(isNull(issues.trashedAt), isNull(issues.archivedAt), isNull(issues.movedToIssueId), ne(statuses.category, 'done'), ne(statuses.category, 'canceled')))
      .groupBy(issues.teamId);
  }

  async recentlyUpdated(limit = 20): Promise<IssueRow[]> {
    return this.db
      .select()
      .from(issues)
      .where(and(isNull(issues.trashedAt), isNull(issues.movedToIssueId)))
      .orderBy(desc(issues.updatedAt))
      .limit(limit);
  }
}

export { compileFilter } from './filter-sql';
export type { GroupBy } from './filter-sql';
