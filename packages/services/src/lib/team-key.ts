import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/**
 * A subquery of team ids that answer to `key`, whether it is the team's current `teams.key` or a
 * historical alias in `team_key_aliases`. The alias table is the fast path, but the live key is
 * included so a team row that somehow lacks an alias row (a restored or hand-edited database, or a
 * future migration that inserts teams directly) is still resolvable rather than invisible.
 */
export function teamIdsFor(key: string): SQL {
  const upper = key.toUpperCase();
  return sql`(select t.id from teams t where t.key = ${upper} union select a.team_id from team_key_aliases a where a.key = ${upper})`;
}
