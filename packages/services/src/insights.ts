import { sql } from 'drizzle-orm';
import { ServiceBase } from './base';
import type { ServiceActor } from './context';
import { assertCan } from './lib/permissions';

/** Minimal insights (SPEC §4.11.7): created vs completed (12 weeks) and cycle velocity. */
export class InsightsService extends ServiceBase {
  async createdVsCompleted(actor: ServiceActor, opts: { weeks?: number; teamId?: string | null } = {}) {
    assertCan(actor, 'issue.read');
    const weeks = Math.min(Math.max(opts.weeks ?? 12, 1), 52);
    const teamCond = opts.teamId ? sql`and team_id = ${opts.teamId}::uuid` : sql``;
    const res = await this.db.execute<{ week: Date; created: number; completed: number }>(sql`
      with w as (
        select generate_series(date_trunc('week', now()) - make_interval(weeks => ${weeks - 1}), date_trunc('week', now()), interval '1 week') as week
      )
      select w.week,
        (select count(*)::int from issues where date_trunc('week', created_at) = w.week and trashed_at is null and moved_to_issue_id is null ${teamCond}) as created,
        (select count(*)::int from issues where date_trunc('week', completed_at) = w.week and trashed_at is null and moved_to_issue_id is null ${teamCond}) as completed
      from w order by w.week`);
    return res.rows.map((r) => ({ weekStart: new Date(r.week), created: Number(r.created), completed: Number(r.completed) }));
  }

  async velocityByTeam(actor: ServiceActor, cycles = 6) {
    assertCan(actor, 'issue.read');
    const res = await this.db.execute<{ team_id: string; key: string; name: string; cycle_id: string; number: number; completed_points: number; completed_count: number; scope_points: number }>(sql`
      select t.id as team_id, t.key, t.name, c.id as cycle_id, c.number,
        coalesce((c.stats->>'completedPoints')::int, 0) as completed_points,
        coalesce((c.stats->>'completedCount')::int, 0) as completed_count,
        coalesce((c.stats->>'scopePoints')::int, 0) as scope_points
      from teams t
      join lateral (
        select * from cycles c where c.team_id = t.id and c.closed_at is not null and c.stats is not null
        order by c.number desc limit ${cycles}
      ) c on true
      where t.deleted_at is null and t.cycle_enabled
      order by t.sort_order, t.key, c.number`);
    const byTeam = new Map<string, { teamId: string; key: string; name: string; cycles: { cycleId: string; number: number; completedPoints: number; completedCount: number; scopePoints: number }[] }>();
    for (const r of res.rows) {
      const t = byTeam.get(r.team_id) ?? { teamId: r.team_id, key: r.key, name: r.name, cycles: [] };
      t.cycles.push({ cycleId: r.cycle_id, number: Number(r.number), completedPoints: Number(r.completed_points), completedCount: Number(r.completed_count), scopePoints: Number(r.scope_points) });
      byTeam.set(r.team_id, t);
    }
    return [...byTeam.values()];
  }
}
