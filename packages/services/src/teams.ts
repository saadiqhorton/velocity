import { and, asc, eq, inArray, isNull, max, ne, sql } from 'drizzle-orm';
import { issues, statuses, teamCounters, teamKeyAliases, teamMembers, teams, users, workflows } from '@velocity/schema';
import type { CarryOver, PaletteColor, StatusCategory } from '@velocity/schema';
import { MAX_STATUSES_PER_TEAM, PALETTE_COLORS, STATUS_CATEGORIES, TEAM_KEY_RE } from '@velocity/schema';
import { publish } from '@velocity/events';
import { ServiceBase } from './base';
import type { AuditService } from './audit';
import type { ServiceActor } from './context';
import { toActorRef } from './context';
import type { DbOrTx, Tx } from './db';
import { conflict, isUniqueViolation, notFound, validation } from './errors';
import type { IssueService } from './issues';
import { orderBetween } from './lib/fractional-order';
import { assertCan } from './lib/permissions';
import { assertTimezone } from './users';

export type TeamRow = typeof teams.$inferSelect;
export type StatusRow = typeof statuses.$inferSelect;

export const CATEGORY_RANK: Record<StatusCategory, number> = { backlog: 0, todo: 1, in_progress: 2, done: 3, canceled: 4 };

/** SPEC §3.6 default workflow: Backlog → Todo → In Progress → Done → Canceled. */
export const DEFAULT_STATUSES: { name: string; category: StatusCategory; color: PaletteColor }[] = [
  { name: 'Backlog', category: 'backlog', color: 'grey' },
  { name: 'Todo', category: 'todo', color: 'blue' },
  { name: 'In Progress', category: 'in_progress', color: 'yellow' },
  { name: 'Done', category: 'done', color: 'green' },
  { name: 'Canceled', category: 'canceled', color: 'grey' },
];

export interface TeamInput {
  key: string;
  name: string;
  icon?: string | null;
  color?: PaletteColor | null;
  description?: string | null;
  cycleEnabled?: boolean | null;
  cycleLengthWeeks?: number | null;
  cycleStartDay?: number | null;
  cycleTimezone?: string | null;
  carryOver?: CarryOver | null;
  estimateScale?: 'linear' | 'fibonacci' | 'exponential' | 'tshirt' | null;
}

function sortStatuses(rows: StatusRow[]): StatusRow[] {
  return [...rows].sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || a.order - b.order);
}

export class TeamService extends ServiceBase {
  private audit!: AuditService;
  private issueService!: IssueService;
  /**
   * Uppercase-key → team row. `getByKey` runs on every list request (SPEC §4.16),
   * so it is cached in-process; every mutation below clears it, so cached rows
   * can never be stale.
   */
  private readonly keyCache = new Map<string, TeamRow | null>();
  bind(audit: AuditService, issueService: IssueService): void {
    this.audit = audit;
    this.issueService = issueService;
  }

  // ───────────── Teams ─────────────

  async list(_actor: ServiceActor | null, opts: { includeArchived?: boolean } = {}): Promise<TeamRow[]> {
    return this.db
      .select()
      .from(teams)
      .where(and(isNull(teams.deletedAt), opts.includeArchived ? undefined : isNull(teams.archivedAt)))
      .orderBy(asc(teams.sortOrder), asc(teams.key));
  }

  async get(id: string): Promise<TeamRow | null> {
    const [t] = await this.db.select().from(teams).where(and(eq(teams.id, id), isNull(teams.deletedAt)));
    return t ?? null;
  }

  async getMany(ids: readonly string[]): Promise<TeamRow[]> {
    if (!ids.length) return [];
    return this.db.select().from(teams).where(inArray(teams.id, [...ids]));
  }

  async getByKey(key: string): Promise<TeamRow | null> {
    const upper = key.toUpperCase();
    const cached = this.keyCache.get(upper);
    if (cached !== undefined) return cached;
    const [t] = await this.db.select().from(teams).where(and(eq(teams.key, upper), isNull(teams.deletedAt)));
    const [aliased] = t ? [] : await this.db.select({ team: teams }).from(teamKeyAliases)
      .innerJoin(teams, eq(teams.id, teamKeyAliases.teamId))
      .where(and(eq(teamKeyAliases.key, upper), isNull(teams.deletedAt)));
    const row = t ?? aliased?.team ?? null;
    this.keyCache.set(upper, row);
    return row;
  }

  async allKeys(): Promise<string[]> {
    return (await this.db.select({ key: teamKeyAliases.key }).from(teamKeyAliases)).map((row) => row.key);
  }

  private async reserveKey(tx: Tx, key: string, teamId: string): Promise<void> {
    await tx.insert(teamKeyAliases).values({ key, teamId }).onConflictDoNothing();
    const [alias] = await tx.select({ teamId: teamKeyAliases.teamId }).from(teamKeyAliases).where(eq(teamKeyAliases.key, key));
    if (alias?.teamId !== teamId) throw conflict(`A team has already used key ${key}.`, { field: 'key' });
  }

  async require(id: string, executor: DbOrTx = this.db): Promise<TeamRow> {
    const [t] = await executor.select().from(teams).where(and(eq(teams.id, id), isNull(teams.deletedAt)));
    if (!t) throw notFound('Team');
    return t;
  }

  private validateInput(input: Partial<TeamInput>): void {
    if (input.key !== undefined && !TEAM_KEY_RE.test(input.key)) {
      throw validation('Team keys are 1–10 uppercase letters or digits and start with a letter, like ENG.', { field: 'key' });
    }
    if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 64)) {
      throw validation('Team name must be 1–64 characters.', { field: 'name' });
    }
    if (input.color && !PALETTE_COLORS.includes(input.color)) throw validation('Pick a color from the palette.', { field: 'color' });
    if (input.cycleLengthWeeks != null && (input.cycleLengthWeeks < 1 || input.cycleLengthWeeks > 8)) {
      throw validation('Cycles are 1–8 weeks long.', { field: 'cycleLengthWeeks' });
    }
    if (input.cycleStartDay != null && (input.cycleStartDay < 0 || input.cycleStartDay > 6)) {
      throw validation('Cycle start day must be 0 (Sunday) to 6 (Saturday).', { field: 'cycleStartDay' });
    }
    if (input.cycleTimezone) assertTimezone(input.cycleTimezone);
    if (input.description && input.description.length > 2000) throw validation('Description is too long.', { field: 'description' });
  }

  async create(actor: ServiceActor, input: TeamInput): Promise<TeamRow> {
    assertCan(actor, 'team.write');
    const key = input.key.trim().toUpperCase();
    this.validateInput({ ...input, key });
    try {
      const team = await this.tx(async (tx) => {
        const [maxOrder] = await tx.select({ m: max(teams.sortOrder) }).from(teams);
        const [t] = await tx
          .insert(teams)
          .values({
            key,
            name: input.name.trim(),
            icon: input.icon ?? null,
            color: input.color ?? 'blue',
            description: input.description ?? null,
            cycleEnabled: input.cycleEnabled ?? false,
            cycleLengthWeeks: input.cycleLengthWeeks ?? 2,
            cycleStartDay: input.cycleStartDay ?? 1,
            cycleTimezone: input.cycleTimezone ?? 'UTC',
            carryOver: input.carryOver ?? 'next_cycle',
            estimateScale: input.estimateScale ?? 'fibonacci',
            sortOrder: (maxOrder?.m ?? 0) + 1000,
          })
          .returning();
        if (!t) throw new Error('team insert failed');
        await this.reserveKey(tx, key, t.id);
        await tx.insert(teamCounters).values({ teamId: t.id, nextNumber: 1 });
        const [wf] = await tx.insert(workflows).values({ teamId: t.id }).returning();
        if (!wf) throw new Error('workflow insert failed');
        await tx.insert(statuses).values(
          DEFAULT_STATUSES.map((s, i) => ({ workflowId: wf.id, teamId: t.id, name: s.name, category: s.category, color: s.color, order: (i + 1) * 1000 })),
        );
        if (actor.userId) await tx.insert(teamMembers).values({ teamId: t.id, userId: actor.userId }).onConflictDoNothing();
        await publish(tx, 'team.updated', { teamId: t.id, actor: toActorRef(actor) });
        return t;
      });
      if (team.cycleEnabled) await this.jobs.send('cycles', { type: 'rotate_team', teamId: team.id });
      this.keyCache.clear();
      return team;
    } catch (err) {
      if (isUniqueViolation(err, 'teams_key_uq') || isUniqueViolation(err, 'team_key_aliases_pkey')) throw conflict(`A team with key ${key} already exists.`, { field: 'key' });
      throw err;
    }
  }

  async update(actor: ServiceActor, id: string, patch: Partial<TeamInput>): Promise<TeamRow> {
    assertCan(actor, 'team.write');
    const key = patch.key?.trim().toUpperCase();
    this.validateInput({ ...patch, key });
    const current = await this.require(id);
    const set: Partial<typeof teams.$inferInsert> = { updatedAt: this.now() };
    if (key !== undefined) set.key = key;
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.color) set.color = patch.color;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.cycleEnabled != null) set.cycleEnabled = patch.cycleEnabled;
    if (patch.cycleLengthWeeks != null) set.cycleLengthWeeks = patch.cycleLengthWeeks;
    if (patch.cycleStartDay != null) set.cycleStartDay = patch.cycleStartDay;
    if (patch.cycleTimezone) set.cycleTimezone = patch.cycleTimezone;
    if (patch.carryOver) set.carryOver = patch.carryOver;
    if (patch.estimateScale) set.estimateScale = patch.estimateScale;
    try {
      const team = await this.tx(async (tx) => {
        if (key !== undefined) await this.reserveKey(tx, key, id);
        const [t] = await tx.update(teams).set(set).where(eq(teams.id, id)).returning();
        if (!t) throw notFound('Team');
        await publish(tx, 'team.updated', { teamId: id, actor: toActorRef(actor) });
        return t;
      });
      if (team.cycleEnabled && !current.cycleEnabled) await this.jobs.send('cycles', { type: 'rotate_team', teamId: id });
      this.keyCache.clear();
      return team;
    } catch (err) {
      if (isUniqueViolation(err, 'teams_key_uq') || isUniqueViolation(err, 'team_key_aliases_pkey')) throw conflict(`A team with key ${key} already exists.`, { field: 'key' });
      throw err;
    }
  }

  async setArchived(actor: ServiceActor, id: string, archived: boolean): Promise<TeamRow> {
    assertCan(actor, 'team.write');
    const [t] = await this.db
      .update(teams)
      .set({ archivedAt: archived ? this.now() : null, updatedAt: this.now() })
      .where(and(eq(teams.id, id), isNull(teams.deletedAt)))
      .returning();
    if (!t) throw notFound('Team');
    await publish(this.db, 'team.updated', { teamId: id, actor: toActorRef(actor) });
    this.keyCache.clear();
    return t;
  }

  async reorder(actor: ServiceActor, id: string, beforeId: string | null, afterId: string | null): Promise<TeamRow> {
    assertCan(actor, 'team.write');
    const ids = [beforeId, afterId].filter((x): x is string => Boolean(x));
    const neighbours = ids.length ? await this.db.select().from(teams).where(inArray(teams.id, ids)) : [];
    const before = neighbours.find((n) => n.id === beforeId)?.sortOrder ?? null;
    const after = neighbours.find((n) => n.id === afterId)?.sortOrder ?? null;
    const [t] = await this.db.update(teams).set({ sortOrder: orderBetween(before, after) }).where(eq(teams.id, id)).returning();
    if (!t) throw notFound('Team');
    this.keyCache.clear();
    return t;
  }

  /**
   * Soft-delete with issue reassignment (SPEC §3.4): every issue is moved to the target
   * team (new numbers minted, moved-pointers kept), then the team is marked deleted.
   */
  async delete(actor: ServiceActor, id: string, opts: { moveIssuesToTeamId?: string | null; confirmKey: string }): Promise<void> {
    assertCan(actor, 'team.write');
    const team = await this.require(id);
    if (opts.confirmKey.trim().toUpperCase() !== team.key) throw validation(`Type ${team.key} to confirm.`, { field: 'confirmKey' });
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(issues)
      .where(and(eq(issues.teamId, id), isNull(issues.movedToIssueId)));
    if (n > 0) {
      if (!opts.moveIssuesToTeamId) throw validation(`Move this team’s ${n} issues to another team before deleting it.`, { field: 'moveIssuesToTeamId' });
      if (opts.moveIssuesToTeamId === id) throw validation('Pick a different team.');
      await this.require(opts.moveIssuesToTeamId);
      await this.issueService.moveAllFromTeam(actor, id, opts.moveIssuesToTeamId);
    }
    await this.tx(async (tx) => {
      await tx.update(teams).set({ deletedAt: this.now(), updatedAt: this.now() }).where(eq(teams.id, id));
      await this.audit.log(tx, actor, { action: 'team.deleted', objectType: 'team', objectId: id, changes: { key: team.key, name: team.name, movedTo: opts.moveIssuesToTeamId ?? null } });
      await publish(tx, 'team.updated', { teamId: id, actor: toActorRef(actor) });
    });
    // Keep the key reserved: historical issue identifiers may still point through moved issues.
    this.keyCache.clear();
  }

  // ───────────── Membership (optional, SPEC §3.4.1) ─────────────

  async members(teamId: string) {
    return this.db
      .select({ user: users })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(and(eq(teamMembers.teamId, teamId), isNull(users.deletedAt)))
      .then((rows) => rows.map((r) => r.user));
  }

  async setMembership(actor: ServiceActor, teamId: string, userId: string, member: boolean): Promise<void> {
    assertCan(actor, 'team.write');
    await this.require(teamId);
    if (member) await this.db.insert(teamMembers).values({ teamId, userId }).onConflictDoNothing();
    else await this.db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    await publish(this.db, 'team.updated', { teamId, actor: toActorRef(actor) });
  }

  // ───────────── Workflow statuses (SPEC §3.6) ─────────────

  async statuses(teamId: string, executor: DbOrTx = this.db): Promise<StatusRow[]> {
    const rows = await executor
      .select()
      .from(statuses)
      .where(and(eq(statuses.teamId, teamId), isNull(statuses.archivedAt)));
    return sortStatuses(rows);
  }

  async statusesForTeams(teamIds: readonly string[]): Promise<StatusRow[]> {
    if (!teamIds.length) return [];
    const rows = await this.db
      .select()
      .from(statuses)
      .where(and(inArray(statuses.teamId, [...teamIds]), isNull(statuses.archivedAt)));
    return sortStatuses(rows);
  }

  async getStatus(id: string, executor: DbOrTx = this.db): Promise<StatusRow | null> {
    const [s] = await executor.select().from(statuses).where(eq(statuses.id, id));
    return s ?? null;
  }

  async getStatuses(ids: readonly string[]): Promise<StatusRow[]> {
    if (!ids.length) return [];
    return this.db.select().from(statuses).where(inArray(statuses.id, [...ids]));
  }

  /** SPEC §3.5: default status = first backlog/todo status in workflow order. */
  async defaultStatus(teamId: string, executor: DbOrTx = this.db): Promise<StatusRow> {
    const all = await this.statuses(teamId, executor);
    const s = all.find((x) => x.category === 'backlog') ?? all.find((x) => x.category === 'todo') ?? all[0];
    if (!s) throw validation('This team has no workflow statuses.');
    return s;
  }

  async statusByName(teamId: string, name: string, executor: DbOrTx = this.db): Promise<StatusRow | null> {
    const [s] = await executor
      .select()
      .from(statuses)
      .where(and(eq(statuses.teamId, teamId), isNull(statuses.archivedAt), sql`lower(${statuses.name}) = lower(${name})`));
    return s ?? null;
  }

  async firstStatusOfCategory(teamId: string, category: StatusCategory, executor: DbOrTx = this.db): Promise<StatusRow | null> {
    return (await this.statuses(teamId, executor)).find((s) => s.category === category) ?? null;
  }

  private async bumpWorkflow(tx: Tx, teamId: string): Promise<void> {
    await tx.update(workflows).set({ version: sql`${workflows.version} + 1` }).where(eq(workflows.teamId, teamId));
  }

  async createStatus(
    actor: ServiceActor,
    teamId: string,
    input: { name: string; category: StatusCategory; color: PaletteColor; description?: string | null },
    executor?: Tx,
  ): Promise<StatusRow> {
    assertCan(actor, 'team.write');
    const name = input.name.trim();
    if (!name || name.length > 32) throw validation('Status names are 1–32 characters.', { field: 'name' });
    if (!STATUS_CATEGORIES.includes(input.category)) throw validation('Unknown status category.', { field: 'category' });
    if (!PALETTE_COLORS.includes(input.color)) throw validation('Pick a color from the palette.', { field: 'color' });
    const run = async (tx: Tx): Promise<StatusRow> => {
      const existing = await this.statuses(teamId, tx);
      if (existing.length >= MAX_STATUSES_PER_TEAM) throw validation(`A team can have at most ${MAX_STATUSES_PER_TEAM} statuses.`);
      if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw conflict(`A status named “${name}” already exists.`, { field: 'name' });
      const [wf] = await tx.select().from(workflows).where(eq(workflows.teamId, teamId));
      if (!wf) throw notFound('Workflow');
      const sameCat = existing.filter((s) => s.category === input.category);
      const order = sameCat.length ? Math.max(...sameCat.map((s) => s.order)) + 1000 : (CATEGORY_RANK[input.category] + 1) * 1000 + 500;
      const [row] = await tx
        .insert(statuses)
        .values({ workflowId: wf.id, teamId, name, category: input.category, color: input.color, order, description: input.description ?? null })
        .returning();
      if (!row) throw new Error('status insert failed');
      await this.bumpWorkflow(tx, teamId);
      await publish(tx, 'team.updated', { teamId, actor: toActorRef(actor) });
      return row;
    };
    return executor ? run(executor) : this.tx(run);
  }

  async updateStatus(
    actor: ServiceActor,
    id: string,
    patch: { name?: string | null; color?: PaletteColor | null; description?: string | null; category?: StatusCategory | null },
  ): Promise<StatusRow> {
    assertCan(actor, 'team.write');
    const current = await this.getStatus(id);
    if (!current || current.archivedAt) throw notFound('Status');
    const set: Partial<typeof statuses.$inferInsert> = {};
    if (patch.name != null) {
      const name = patch.name.trim();
      if (!name || name.length > 32) throw validation('Status names are 1–32 characters.', { field: 'name' });
      set.name = name;
    }
    if (patch.color) {
      if (!PALETTE_COLORS.includes(patch.color)) throw validation('Pick a color from the palette.', { field: 'color' });
      set.color = patch.color;
    }
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.category && patch.category !== current.category) {
      await this.assertCategoryKeepsMinimum(current, patch.category);
      set.category = patch.category;
    }
    try {
      return await this.tx(async (tx) => {
        const [row] = await tx.update(statuses).set(set).where(eq(statuses.id, id)).returning();
        if (!row) throw notFound('Status');
        await this.bumpWorkflow(tx, current.teamId);
        await publish(tx, 'team.updated', { teamId: current.teamId, actor: toActorRef(actor) });
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'statuses_name_uq')) throw conflict('A status with that name already exists.', { field: 'name' });
      throw err;
    }
  }

  async reorderStatus(actor: ServiceActor, id: string, beforeId: string | null, afterId: string | null): Promise<StatusRow> {
    assertCan(actor, 'team.write');
    const ids = [beforeId, afterId].filter((x): x is string => Boolean(x));
    const neighbours = ids.length ? await this.db.select().from(statuses).where(inArray(statuses.id, ids)) : [];
    const before = neighbours.find((n) => n.id === beforeId)?.order ?? null;
    const after = neighbours.find((n) => n.id === afterId)?.order ?? null;
    const [row] = await this.db.update(statuses).set({ order: orderBetween(before, after) }).where(eq(statuses.id, id)).returning();
    if (!row) throw notFound('Status');
    await publish(this.db, 'team.updated', { teamId: row.teamId, actor: toActorRef(actor) });
    return row;
  }

  private async assertCategoryKeepsMinimum(status: StatusRow, newCategory: StatusCategory | null): Promise<void> {
    const all = await this.statuses(status.teamId);
    const remaining = all.filter((s) => s.id !== status.id);
    if (newCategory) remaining.push({ ...status, category: newCategory });
    const has = (cats: StatusCategory[]) => remaining.some((s) => cats.includes(s.category));
    if (!has(['backlog', 'todo'])) throw validation('A workflow needs at least one Backlog or Todo status.');
    if (!has(['in_progress'])) throw validation('A workflow needs at least one In Progress status.');
    if (!has(['done'])) throw validation('A workflow needs at least one Done status.');
    if (!has(['canceled'])) throw validation('A workflow needs at least one Canceled status.');
  }

  /** Delete when unused, or reassign its issues to `replacementStatusId` (SPEC §3.6). */
  async deleteStatus(actor: ServiceActor, id: string, replacementStatusId?: string | null): Promise<void> {
    assertCan(actor, 'team.write');
    const status = await this.getStatus(id);
    if (!status || status.archivedAt) throw notFound('Status');
    await this.assertCategoryKeepsMinimum(status, null);
    await this.tx(async (tx) => {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(issues).where(eq(issues.statusId, id));
      if (n > 0) {
        if (!replacementStatusId) throw validation(`${n} issues use this status. Pick a status to move them to.`, { field: 'replacementStatusId', count: n });
        const repl = await this.getStatus(replacementStatusId, tx);
        if (!repl || repl.teamId !== status.teamId || repl.archivedAt || repl.id === id) throw validation('Pick another status from the same team.');
        const affected = await tx.select({ id: issues.id }).from(issues).where(eq(issues.statusId, id));
        for (const { id: issueId } of affected) {
          await this.issueService.updateInTx(tx, actor, issueId, { statusId: repl.id });
        }
      }
      await tx.update(statuses).set({ archivedAt: this.now() }).where(eq(statuses.id, id));
      await this.bumpWorkflow(tx, status.teamId);
      await publish(tx, 'team.updated', { teamId: status.teamId, actor: toActorRef(actor) });
    });
  }

  async issueCount(teamId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(issues)
      .where(and(eq(issues.teamId, teamId), isNull(issues.trashedAt), isNull(issues.movedToIssueId), ne(issues.teamId, sql`'00000000-0000-0000-0000-000000000000'::uuid`)));
    return r?.n ?? 0;
  }
}
