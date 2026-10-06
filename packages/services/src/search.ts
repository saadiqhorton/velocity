import { sql } from 'drizzle-orm';
import { ServiceBase } from './base';
import type { ServiceActor } from './context';
import { assertCan } from './lib/permissions';
import { teamIdsFor } from './lib/team-key';

export type SearchType = 'issue' | 'project' | 'team' | 'member' | 'view';

export type SearchHit = {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string | null;
  rank: number;
};

const IDENT_RE = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d+)$/;

/**
 * One search engine for the palette, the search screen and MCP `search_issues` (SPEC §5.7):
 * Postgres FTS (websearch_to_tsquery, ts_rank + recency boost), pg_trgm similarity for
 * fuzzy titles, and an identifier fast-path for `ENG-123`.
 */
export class SearchService extends ServiceBase {
  async search(actor: ServiceActor, query: string, opts: { types?: SearchType[] | null; limit?: number | null; teamId?: string | null } = {}): Promise<SearchHit[]> {
    assertCan(actor, 'issue.read');
    const q = query.trim().slice(0, 200);
    if (!q) return [];
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const types = new Set<SearchType>(opts.types?.length ? opts.types : ['issue', 'project', 'team', 'member', 'view']);
    const hits: SearchHit[] = [];
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    if (types.has('issue')) hits.push(...(await this.searchIssues(q, limit, opts.teamId ?? null)));
    if (types.has('project')) {
      const r = await this.db.execute<SearchHit>(sql`
        select 'project' as type, id, name as title, status as subtitle,
          greatest(similarity(name, ${q}), case when name ilike ${like} then 0.6 else 0 end) as rank
        from projects where trashed_at is null and (name ilike ${like} or name % ${q})
        order by rank desc limit ${limit}`);
      hits.push(...r.rows);
    }
    if (types.has('team')) {
      const r = await this.db.execute<SearchHit>(sql`
        select 'team' as type, id, name as title, key as subtitle,
          case when key = ${q.toUpperCase()} then 1 else greatest(similarity(name, ${q}), 0.5) end as rank
        from teams where deleted_at is null and (key = ${q.toUpperCase()} or name ilike ${like} or key ilike ${like})
        order by rank desc limit ${limit}`);
      hits.push(...r.rows);
    }
    if (types.has('member')) {
      const r = await this.db.execute<SearchHit>(sql`
        select 'member' as type, id, name as title, username::text as subtitle,
          greatest(similarity(name, ${q}), case when username::text ilike ${like} then 0.7 else 0.4 end) as rank
        from users where deleted_at is null and (name ilike ${like} or username::text ilike ${like})
        order by rank desc limit ${limit}`);
      hits.push(...r.rows);
    }
    if (types.has('view') && actor.userId) {
      const r = await this.db.execute<SearchHit>(sql`
        select 'view' as type, id, name as title, null as subtitle, 0.5 as rank
        from views where owner_id = ${actor.userId} and name ilike ${like}
        order by name limit ${limit}`);
      hits.push(...r.rows);
    }
    return hits.map((h) => ({ ...h, rank: Number(h.rank) }));
  }

  /** Issue search returning ids in rank order (used by SearchService + GraphQL issueSearch + MCP). */
  async searchIssueIds(q: string, limit: number, teamId: string | null = null): Promise<string[]> {
    return (await this.searchIssues(q, limit, teamId)).map((h) => h.id);
  }

  private async searchIssues(q: string, limit: number, teamId: string | null): Promise<SearchHit[]> {
    const ident = IDENT_RE.exec(q);
    if (ident) {
      const r = await this.db.execute<SearchHit>(sql`
        select 'issue' as type, i.id, i.title, t.key || '-' || i.number as subtitle, 2.0 as rank
        from issues i join teams t on t.id = i.team_id
        where t.id in ${teamIdsFor(ident[1]!)} and i.number = ${Number(ident[2])} and i.trashed_at is null
        limit 1`);
      if (r.rows.length) return r.rows;
    }
    const teamCond = teamId ? sql`and i.team_id = ${teamId}::uuid` : sql``;
    const numeric = /^\d+$/.test(q) ? Number(q) : -1;
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const r = await this.db.execute<SearchHit>(sql`
      with q as (select websearch_to_tsquery('english', ${q}) as tsq)
      select 'issue' as type, i.id, i.title, t.key || '-' || i.number as subtitle,
        (ts_rank(i.search_vector, q.tsq)
          + similarity(i.title, ${q}) * 0.5
          + case when i.number = ${numeric} then 1 else 0 end
          + 0.1 / (1 + extract(epoch from (now() - i.updated_at)) / 2592000)) as rank
      from issues i join teams t on t.id = i.team_id, q
      where i.trashed_at is null and i.moved_to_issue_id is null and t.deleted_at is null ${teamCond}
        and (i.search_vector @@ q.tsq or i.title % ${q} or i.title ilike ${like} or i.number = ${numeric})
      order by rank desc, i.updated_at desc
      limit ${limit}`);
    return r.rows;
  }
}
