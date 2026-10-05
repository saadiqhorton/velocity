import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { cycleHistory, cycles, issues, statuses, teams } from '@velocity/schema';
import type { CycleStats } from '@velocity/schema';
import { publish } from '@velocity/events';
import { ServiceBase } from './base';
import type { AuditService } from './audit';
import type { ServiceActor } from './context';
import { systemActor } from './context';
import type { Tx } from './db';
import { notFound, validation } from './errors';
import type { IssueService } from './issues';
import { isClosingWithin, planRotation, velocity } from './lib/cycle-math';
import type { CycleSettings } from './lib/cycle-math';
import { assertCan } from './lib/permissions';

export type CycleRow = typeof cycles.$inferSelect;
type TeamRow = typeof teams.$inferSelect;

export type CycleLiveStats = {
  scopeCount: number;
  scopePoints: number;
  completedCount: number;
  completedPoints: number;
  startedCount: number;
  canceledCount: number;
  addedAfterStartCount: number;
};

function settingsOf(team: TeamRow): CycleSettings {
  return { lengthWeeks: team.cycleLengthWeeks, startDay: team.cycleStartDay, timezone: team.cycleTimezone };
}

/** Cycles (SPEC §3.8): per-team timeboxes with daily auto-rotation. */
export class CycleService extends ServiceBase {
  private issueService!: IssueService;
  private audit!: AuditService;
  bind(issueService: IssueService, audit: AuditService): void {
    this.issueService = issueService;
    this.audit = audit;
  }

  async list(teamId: string, opts: { includeClosed?: boolean; limit?: number } = {}): Promise<CycleRow[]> {
    return this.db
      .select()
      .from(cycles)
      .where(and(eq(cycles.teamId, teamId), opts.includeClosed === false ? isNull(cycles.closedAt) : undefined))
      .orderBy(desc(cycles.number))
      .limit(opts.limit ?? 100);
  }

  async get(id: string): Promise<CycleRow | null> {
    const [c] = await this.db.select().from(cycles).where(eq(cycles.id, id));
    return c ?? null;
  }

  async getMany(ids: readonly string[]): Promise<CycleRow[]> {
    if (!ids.length) return [];
    return this.db.select().from(cycles).where(inArray(cycles.id, [...ids]));
  }

  async current(teamId: string): Promise<CycleRow | null> {
    const now = this.now();
    const [c] = await this.db
      .select()
      .from(cycles)
      .where(and(eq(cycles.teamId, teamId), lte(cycles.startsAt, now), gt(cycles.endsAt, now), isNull(cycles.closedAt)))
      .limit(1);
    return c ?? null;
  }

  async upcoming(teamId: string): Promise<CycleRow[]> {
    return this.db
      .select()
      .from(cycles)
      .where(and(eq(cycles.teamId, teamId), gt(cycles.startsAt, this.now()), isNull(cycles.closedAt)))
      .orderBy(asc(cycles.startsAt));
  }

  async rename(actor: ServiceActor, id: string, name: string | null): Promise<CycleRow> {
    assertCan(actor, 'cycle.write');
    const n = name?.trim() || null;
    if (n && n.length > 64) throw validation('Cycle names are at most 64 characters.', { field: 'name' });
    const [c] = await this.db.update(cycles).set({ name: n }).where(eq(cycles.id, id)).returning();
    if (!c) throw notFound('Cycle');
    return c;
  }

  /** Live progress for open cycles (header progress bar + velocity sparkline inputs). */
  async liveStats(cycleIds: readonly string[]): Promise<Map<string, CycleLiveStats>> {
    const out = new Map<string, CycleLiveStats>();
    if (!cycleIds.length) return out;
    const rows = await this.db.execute<CycleLiveStats & { cycle_id: string }>(sql`
      select i.cycle_id,
        count(*) filter (where st.category <> 'canceled')::int as "scopeCount",
        coalesce(sum(i.estimate) filter (where st.category <> 'canceled'), 0)::int as "scopePoints",
        count(*) filter (where st.category = 'done')::int as "completedCount",
        coalesce(sum(i.estimate) filter (where st.category = 'done'), 0)::int as "completedPoints",
        count(*) filter (where st.category = 'in_progress')::int as "startedCount",
        count(*) filter (where st.category = 'canceled')::int as "canceledCount",
        count(*) filter (where exists (
          select 1 from cycle_history h join cycles c on c.id = h.cycle_id
          where h.cycle_id = i.cycle_id and h.issue_id = i.id and h.removed_at is null and h.added_at > c.starts_at
        ))::int as "addedAfterStartCount"
      from issues i join statuses st on st.id = i.status_id
      where i.cycle_id in ${sql`(${sql.join(cycleIds.map((id) => sql`${id}::uuid`), sql`, `)})`}
        and i.trashed_at is null and i.moved_to_issue_id is null
      group by i.cycle_id`);
    for (const r of rows.rows) {
      const { cycle_id, ...stats } = r;
      out.set(cycle_id, stats);
    }
    for (const id of cycleIds) {
      if (!out.has(id)) out.set(id, { scopeCount: 0, scopePoints: 0, completedCount: 0, completedPoints: 0, startedCount: 0, canceledCount: 0, addedAfterStartCount: 0 });
    }
    return out;
  }

  /** Issues added to the cycle after it started (SPEC §3.8 "scope markers"). */
  async addedAfterStart(cycleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ issueId: cycleHistory.issueId })
      .from(cycleHistory)
      .innerJoin(cycles, eq(cycles.id, cycleHistory.cycleId))
      .where(and(eq(cycleHistory.cycleId, cycleId), isNull(cycleHistory.removedAt), sql`${cycleHistory.addedAt} > ${cycles.startsAt}`));
    return rows.map((r) => r.issueId);
  }

  /** Average completed points/count of the last n closed cycles (SPEC §3.8 velocity). */
  async velocity(teamId: string, n = 6): Promise<{ points: number; count: number; history: { cycleId: string; number: number; completedPoints: number; completedCount: number; scopePoints: number }[] }> {
    const closed = await this.db
      .select()
      .from(cycles)
      .where(and(eq(cycles.teamId, teamId), isNotNull(cycles.closedAt), isNotNull(cycles.stats)))
      .orderBy(desc(cycles.number))
      .limit(n);
    const history = closed
      .reverse()
      .map((c) => ({ cycleId: c.id, number: c.number, completedPoints: c.stats?.completedPoints ?? 0, completedCount: c.stats?.completedCount ?? 0, scopePoints: c.stats?.scopePoints ?? 0 }));
    const v = velocity(history, n);
    return { ...v, history };
  }

  /** Teams whose current cycle closes within 24h — workspace banner (SPEC §3.11). */
  async closingSoon(): Promise<CycleRow[]> {
    const now = this.now();
    const open = await this.db
      .select({ c: cycles })
      .from(cycles)
      .innerJoin(teams, eq(teams.id, cycles.teamId))
      .where(and(isNull(cycles.closedAt), lte(cycles.startsAt, now), gt(cycles.endsAt, now), eq(teams.cycleEnabled, true), isNull(teams.deletedAt)));
    return open.map((r) => r.c).filter((c) => isClosingWithin({ startsAt: c.startsAt, endsAt: c.endsAt }, now, 24));
  }

  // ───────────── Rotation (SPEC §3.8, §5.6) ─────────────

  async rotateAll(): Promise<{ teamId: string; closed: number; opened: number }[]> {
    const rows = await this.db.select().from(teams).where(and(eq(teams.cycleEnabled, true), isNull(teams.deletedAt), isNull(teams.archivedAt)));
    const out = [];
    for (const team of rows) out.push({ teamId: team.id, ...(await this.rotateTeam(team.id)) });
    return out;
  }

  /**
   * Idempotent under double-fire: a per-team transactional advisory lock serializes runs,
   * and the planner is a pure function of the persisted cycles + now.
   */
  async rotateTeam(teamId: string, opts: { manualCloseCycleId?: string; actor?: ServiceActor } = {}): Promise<{ closed: number; opened: number }> {
    return this.tx(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'velocity:cycles:' + teamId}))`);
      const [team] = await tx.select().from(teams).where(eq(teams.id, teamId));
      if (!team || team.deletedAt || !team.cycleEnabled) return { closed: 0, opened: 0 };
      const now = this.now();

      if (opts.manualCloseCycleId) {
        // Manual early close: shorten the window to now so the next cycle starts immediately.
        const [closing] = await tx
          .select()
          .from(cycles)
          .where(and(eq(cycles.id, opts.manualCloseCycleId), eq(cycles.teamId, teamId), isNull(cycles.closedAt)));
        await tx
          .update(cycles)
          .set({ endsAt: now })
          .where(and(eq(cycles.id, opts.manualCloseCycleId), eq(cycles.teamId, teamId), isNull(cycles.closedAt)));
        if (closing) {
          // Rotation normally pre-creates the next window. Move its start forward while keeping
          // its scheduled end, so there is no gap and any issues already scoped to it stay put.
          const [next] = await tx
            .select()
            .from(cycles)
            .where(and(eq(cycles.teamId, teamId), isNull(cycles.closedAt), gt(cycles.startsAt, closing.startsAt)))
            .orderBy(asc(cycles.startsAt))
            .limit(1);
          if (next && next.startsAt > now) {
            await tx.update(cycles).set({ startsAt: now }).where(eq(cycles.id, next.id));
          }
        }
      }

      const existing = await tx.select().from(cycles).where(eq(cycles.teamId, teamId)).orderBy(asc(cycles.number));
      const plan = planRotation({
        cycles: existing.map((c) => ({ id: c.id, number: c.number, startsAt: c.startsAt, endsAt: c.endsAt, closedAt: c.closedAt })),
        settings: settingsOf(team),
        now,
        upcomingCount: 1,
      });

      // Open new windows first so carry-over has a destination.
      const created: CycleRow[] = [];
      for (const w of plan.open) {
        const [row] = await tx
          .insert(cycles)
          .values({
            teamId,
            number: w.number,
            startsAt: w.startsAt,
            endsAt: w.endsAt,
            closedAt: w.ended ? w.endsAt : null,
            stats: w.ended ? emptyStats() : null,
          })
          .onConflictDoNothing()
          .returning();
        if (row) created.push(row);
      }

      const all = await tx.select().from(cycles).where(eq(cycles.teamId, teamId)).orderBy(asc(cycles.startsAt));
      for (const id of plan.close) {
        const cycle = all.find((c) => c.id === id);
        if (!cycle) continue;
        const next = all.find((c) => !c.closedAt && c.startsAt.getTime() >= cycle.endsAt.getTime() - 1000 && c.id !== cycle.id && !plan.close.includes(c.id));
        await this.closeInTx(tx, team, cycle, next ?? null, now, opts.actor ?? systemActor('system'));
      }

      const current = all.find((c) => !plan.close.includes(c.id) && !c.closedAt && c.startsAt <= now && c.endsAt > now);
      if (current && (plan.close.length || created.some((c) => c.id === current.id))) {
        await publish(tx, 'cycle.started', { cycleId: current.id, teamId, number: current.number });
      }
      return { closed: plan.close.length, opened: created.length };
    });
  }

  private async closeInTx(tx: Tx, team: TeamRow, cycle: CycleRow, next: CycleRow | null, now: Date, actor: ServiceActor): Promise<void> {
    const inCycle = await tx
      .select({ id: issues.id, estimate: issues.estimate, category: statuses.category })
      .from(issues)
      .innerJoin(statuses, eq(statuses.id, issues.statusId))
      .where(and(eq(issues.cycleId, cycle.id), isNull(issues.trashedAt), isNull(issues.movedToIssueId)));
    const history = await tx.select().from(cycleHistory).where(eq(cycleHistory.cycleId, cycle.id));
    const incomplete = inCycle.filter((i) => i.category !== 'done' && i.category !== 'canceled');
    const stats: CycleStats = {
      scopeCount: inCycle.filter((i) => i.category !== 'canceled').length,
      scopePoints: inCycle.filter((i) => i.category !== 'canceled').reduce((s, i) => s + (i.estimate ?? 0), 0),
      completedCount: inCycle.filter((i) => i.category === 'done').length,
      completedPoints: inCycle.filter((i) => i.category === 'done').reduce((s, i) => s + (i.estimate ?? 0), 0),
      canceledCount: inCycle.filter((i) => i.category === 'canceled').length,
      addedAfterStartCount: history.filter((h) => !h.removedAt && h.addedAt > cycle.startsAt).length,
      removedCount: history.filter((h) => h.removedAt).length,
      carriedOverCount: incomplete.length,
    };
    // Snapshot first (immutable), then carry incomplete issues over (SPEC §3.8).
    await tx.update(cycles).set({ closedAt: now, stats }).where(and(eq(cycles.id, cycle.id), isNull(cycles.closedAt)));
    const target = team.carryOver === 'next_cycle' ? (next?.id ?? null) : null;
    for (const i of incomplete) {
      await this.issueService.updateInTx(tx, actor, i.id, { cycleId: target });
    }
    await publish(tx, 'cycle.closed', { cycleId: cycle.id, teamId: team.id, number: cycle.number, stats: stats as unknown as Record<string, number> });
  }

  /** Manual close (SPEC §5.12: audited). */
  async closeManually(actor: ServiceActor, cycleId: string): Promise<CycleRow> {
    assertCan(actor, 'cycle.close_manual');
    const c = await this.get(cycleId);
    if (!c) throw notFound('Cycle');
    if (c.closedAt) throw validation('This cycle is already closed.');
    if (c.startsAt > this.now()) throw validation('Only the active cycle can be closed early.');
    await this.rotateTeam(c.teamId, { manualCloseCycleId: cycleId, actor });
    await this.audit.log(this.db, actor, { action: 'cycle.closed_manually', objectType: 'cycle', objectId: cycleId, changes: { number: c.number } });
    return (await this.get(cycleId))!;
  }
}

function emptyStats(): CycleStats {
  return { scopeCount: 0, scopePoints: 0, completedCount: 0, completedPoints: 0, canceledCount: 0, addedAfterStartCount: 0, removedCount: 0, carriedOverCount: 0 };
}
