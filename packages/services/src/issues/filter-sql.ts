/**
 * Filter DSL AST → parameterized SQL (SPEC §6.1.4, §7.1.6: "DSL parser → AST → parameterized
 * Drizzle conditions (no string interpolation into SQL, ever)"). Every value below is bound
 * through drizzle's `sql` template; identifiers are fixed.
 *
 * Name resolution happens in SQL (subqueries) so a single round trip serves the query:
 * team by key/name/id, status by name/id, label by name/id (or group name), project by
 * name/id, cycle by keyword/number/name/id, users by username/email/id.
 *
 * Every comparison compiles to a boolean that is never NULL, so `neq` = NOT `eq` holds and
 * `assignee neq:alice` includes unassigned issues.
 */
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type {
  FilterComparison,
  FilterNode,
  FilterOrder,
  FilterScalar,
  FilterValue,
} from '@velocity/schema/filter-ast';
import { validation } from '../errors';

export interface FilterCompileContext {
  /** Resolves `me`. Null (system actor) → `me` matches nothing. */
  actorUserId: string | null;
  now: Date;
}

const NONE = sql`false`;

function scalars(v: FilterValue): FilterScalar[] {
  return v.kind === 'list' ? v.values : [v];
}

function str(s: FilterScalar): string {
  if (s.kind === 'string' || s.kind === 'date') return s.value;
  if (s.kind === 'number') return String(s.value);
  return '';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT_RE = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d+)$/;

/** Text equality on uuid columns without casting errors for non-uuid input. */
function idOrNull(s: string): string | null {
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

function nn(cond: SQL): SQL {
  return sql`coalesce((${cond}), false)`;
}

// ───────────── per-field scalar equality ─────────────

function userIdsSubquery(v: string): SQL {
  const id = idOrNull(v);
  return sql`(select u.id from users u where u.username = ${v.toLowerCase()} or u.email = ${v.toLowerCase()} or u.id = ${id}::uuid)`;
}

function eqScalar(field: FilterComparison['field'], s: FilterScalar, ctx: FilterCompileContext): SQL {
  switch (field) {
    case 'team': {
      const v = str(s);
      return sql`issues.team_id in (select t.id from teams t where t.key = ${v.toUpperCase()} or lower(t.name) = ${v.toLowerCase()} or t.id = ${idOrNull(v)}::uuid)`;
    }
    case 'status': {
      const v = str(s);
      return sql`issues.status_id in (select st.id from statuses st where lower(st.name) = ${v.toLowerCase()} or st.id = ${idOrNull(v)}::uuid)`;
    }
    case 'statusCategory':
      return sql`issues.status_id in (select st.id from statuses st where st.category = ${str(s)})`;
    case 'assignee':
    case 'creator': {
      const col = field === 'assignee' ? sql`issues.assignee_id` : sql`issues.created_by`;
      if (s.kind === 'me') return ctx.actorUserId ? sql`${col} = ${ctx.actorUserId}::uuid` : NONE;
      if (s.kind === 'empty') return sql`${col} is null`;
      return sql`${col} in ${userIdsSubquery(str(s))}`;
    }
    case 'priority':
      return sql`issues.priority = ${Number(str(s))}`;
    case 'estimate':
      if (s.kind === 'empty') return sql`issues.estimate is null`;
      return sql`issues.estimate = ${Number(str(s))}`;
    case 'label': {
      if (s.kind === 'empty') return sql`not exists (select 1 from issue_labels il where il.issue_id = issues.id)`;
      const v = str(s);
      return sql`exists (select 1 from issue_labels il join labels l on l.id = il.label_id
        left join labels g on g.id = l.parent_label_id
        where il.issue_id = issues.id and (lower(l.name) = ${v.toLowerCase()} or l.id = ${idOrNull(v)}::uuid or lower(g.name) = ${v.toLowerCase()}))`;
    }
    case 'project': {
      if (s.kind === 'empty') return sql`issues.project_id is null`;
      const v = str(s);
      return sql`issues.project_id in (select p.id from projects p where lower(p.name) = ${v.toLowerCase()} or p.id = ${idOrNull(v)}::uuid)`;
    }
    case 'cycle': {
      if (s.kind === 'empty') return sql`issues.cycle_id is null`;
      const v = str(s).toLowerCase();
      const now = ctx.now;
      if (v === 'current') {
        return sql`issues.cycle_id in (select c.id from cycles c where c.starts_at <= ${now} and c.ends_at > ${now} and c.closed_at is null)`;
      }
      if (v === 'next') {
        return sql`issues.cycle_id in (select distinct on (c.team_id) c.id from cycles c where c.starts_at > ${now} order by c.team_id, c.starts_at)`;
      }
      if (v === 'previous') {
        return sql`issues.cycle_id in (select distinct on (c.team_id) c.id from cycles c where c.ends_at <= ${now} order by c.team_id, c.ends_at desc)`;
      }
      if (/^\d+$/.test(v)) return sql`issues.cycle_id in (select c.id from cycles c where c.number = ${Number(v)})`;
      return sql`issues.cycle_id in (select c.id from cycles c where lower(c.name) = ${v} or c.id = ${idOrNull(v)}::uuid)`;
    }
    case 'identifier': {
      const m = IDENT_RE.exec(str(s));
      if (!m) return NONE;
      return sql`(issues.number = ${Number(m[2])} and issues.team_id in (select t.id from teams t where t.key = ${m[1]!.toUpperCase()}))`;
    }
    case 'parent': {
      if (s.kind === 'empty') return sql`issues.parent_id is null`;
      const v = str(s);
      const m = IDENT_RE.exec(v);
      if (m) {
        return sql`issues.parent_id in (select p.id from issues p join teams t on t.id = p.team_id where t.key = ${m[1]!.toUpperCase()} and p.number = ${Number(m[2])})`;
      }
      return sql`issues.parent_id = ${idOrNull(v)}::uuid`;
    }
    case 'relations': {
      if (s.kind === 'empty') {
        return sql`not exists (select 1 from issue_relations r where r.source_issue_id = issues.id or r.target_issue_id = issues.id)`;
      }
      switch (str(s)) {
        case 'blocks':
          return sql`exists (select 1 from issue_relations r where r.source_issue_id = issues.id and r.type = 'blocks')`;
        case 'blockedBy':
          return sql`exists (select 1 from issue_relations r join issues b on b.id = r.source_issue_id join statuses bs on bs.id = b.status_id
            where r.target_issue_id = issues.id and r.type = 'blocks' and bs.category not in ('done', 'canceled'))`;
        case 'related':
          return sql`exists (select 1 from issue_relations r where (r.source_issue_id = issues.id or r.target_issue_id = issues.id) and r.type = 'related')`;
        case 'duplicate':
          return sql`exists (select 1 from issue_relations r where r.source_issue_id = issues.id and r.type = 'duplicate')`;
        default:
          return NONE;
      }
    }
    case 'title':
      return sql`lower(issues.title) = ${str(s).toLowerCase()}`;
    case 'description':
      return sql`lower(issues.description_md) = ${str(s).toLowerCase()}`;
    case 'createdAt':
    case 'updatedAt':
    case 'completedAt':
      return dateCompare(field, 'eq', s, ctx);
  }
}

// ───────────── dates ─────────────

const DATE_COLS = { createdAt: sql`issues.created_at`, updatedAt: sql`issues.updated_at`, completedAt: sql`issues.completed_at` } as const;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function resolveInstant(s: FilterScalar, ctx: FilterCompileContext): { start: Date; end: Date | null } {
  if (s.kind === 'relativeDate') {
    const d = new Date(ctx.now);
    switch (s.unit) {
      case 'd':
        d.setUTCDate(d.getUTCDate() + s.amount);
        break;
      case 'w':
        d.setUTCDate(d.getUTCDate() + 7 * s.amount);
        break;
      case 'm':
        d.setUTCMonth(d.getUTCMonth() + s.amount);
        break;
      case 'y':
        d.setUTCFullYear(d.getUTCFullYear() + s.amount);
        break;
    }
    return { start: d, end: null };
  }
  const v = str(s);
  if (DATE_ONLY.test(v)) {
    const start = new Date(`${v}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 86_400_000);
    if (Number.isNaN(start.getTime())) throw validation(`Invalid date “${v}”.`);
    return { start, end };
  }
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) throw validation(`Invalid date “${v}”.`);
  return { start: t, end: null };
}

function dateCompare(field: 'createdAt' | 'updatedAt' | 'completedAt', op: string, s: FilterScalar, ctx: FilterCompileContext): SQL {
  const col = DATE_COLS[field];
  if (s.kind === 'empty') return op === 'neq' ? sql`${col} is not null` : sql`${col} is null`;
  const { start, end } = resolveInstant(s, ctx);
  // A date-only value denotes the whole UTC day [start, end).
  switch (op) {
    case 'eq':
      return end ? sql`(${col} >= ${start} and ${col} < ${end})` : sql`${col} = ${start}`;
    case 'gt':
      return sql`${col} >= ${end ?? start}` as SQL;
    case 'gte':
      return sql`${col} >= ${start}`;
    case 'lt':
      return sql`${col} < ${start}`;
    case 'lte':
      return sql`${col} < ${end ?? start}`;
    default:
      throw validation(`Operator ${op} isn’t supported on ${field}.`);
  }
}

// ───────────── comparisons ─────────────

function likeEscape(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function compileComparison(c: FilterComparison, ctx: FilterCompileContext): SQL {
  const { field, op, value } = c;

  if (field === 'createdAt' || field === 'updatedAt' || field === 'completedAt') {
    if (op === 'in' || op === 'nin') throw validation(`Operator ${op} isn’t supported on ${field}.`);
    const s = scalars(value)[0];
    if (!s) return NONE;
    if (op === 'neq') return sql`not ${nn(dateCompare(field, 'eq', s, ctx))}`;
    return nn(dateCompare(field, op, s, ctx));
  }

  if (field === 'title' || field === 'description') {
    const col = field === 'title' ? sql`issues.title` : sql`issues.description_md`;
    const v = likeEscape(str(scalars(value)[0] ?? { kind: 'string', value: '' }));
    switch (op) {
      case 'contains':
        return nn(sql`${col} ilike ${'%' + v + '%'}`);
      case 'startsWith':
        return nn(sql`${col} ilike ${v + '%'}`);
      case 'endsWith':
        return nn(sql`${col} ilike ${'%' + v}`);
      case 'eq':
        return nn(eqScalar(field, scalars(value)[0]!, ctx));
      case 'neq':
        return sql`not ${nn(eqScalar(field, scalars(value)[0]!, ctx))}`;
      default:
        throw validation(`Operator ${op} isn’t supported on ${field}.`);
    }
  }

  if ((field === 'priority' || field === 'estimate') && ['gt', 'gte', 'lt', 'lte'].includes(op)) {
    const s = scalars(value)[0];
    if (!s || s.kind !== 'number') throw validation(`${field} ${op} needs a number.`);
    const col = field === 'priority' ? sql`issues.priority` : sql`issues.estimate`;
    const opSql = { gt: sql`>`, gte: sql`>=`, lt: sql`<`, lte: sql`<=` }[op as 'gt'];
    return nn(sql`${col} ${opSql} ${s.value}`);
  }

  const anyOf = (): SQL => {
    const parts = scalars(value).map((s) => nn(eqScalar(field, s, ctx)));
    if (parts.length === 0) return NONE;
    if (parts.length === 1) return parts[0]!;
    return sql`(${sql.join(parts, sql` or `)})`;
  };

  switch (op) {
    case 'eq':
    case 'in':
      return anyOf();
    case 'neq':
    case 'nin':
      return sql`not ${anyOf()}`;
    default:
      throw validation(`Operator ${op} isn’t supported on ${field}.`);
  }
}

export function compileFilter(node: FilterNode | null, ctx: FilterCompileContext): SQL | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case 'cmp':
      return compileComparison(node, ctx);
    case 'and': {
      const parts = node.children.map((c) => compileFilter(c, ctx)).filter((x): x is SQL => Boolean(x));
      return parts.length ? sql`(${sql.join(parts, sql` and `)})` : undefined;
    }
    case 'or': {
      const parts = node.children.map((c) => compileFilter(c, ctx)).filter((x): x is SQL => Boolean(x));
      return parts.length ? sql`(${sql.join(parts, sql` or `)})` : undefined;
    }
    case 'not': {
      const inner = compileFilter(node.child, ctx);
      return inner ? sql`not (${inner})` : undefined;
    }
  }
}

// ───────────── ordering & grouping ─────────────

export type GroupBy = 'status' | 'assignee' | 'priority' | 'label' | 'project' | 'cycle' | 'team' | 'none';

export const CATEGORY_RANK_SQL = sql`(case statuses.category when 'backlog' then 0 when 'todo' then 1 when 'in_progress' then 2 when 'done' then 3 else 4 end)`;

/** Ordering prefix so rows of a group are contiguous (labels are grouped client-side). */
export function groupOrder(groupBy: GroupBy | null | undefined): SQL[] {
  switch (groupBy) {
    case 'status':
      return [sql`teams.sort_order`, CATEGORY_RANK_SQL, sql`statuses."order"`, sql`statuses.id`];
    case 'assignee':
      return [sql`assignee.name asc nulls last`, sql`issues.assignee_id`];
    case 'priority':
      return [sql`issues.priority asc`];
    case 'project':
      return [sql`project.name asc nulls last`, sql`issues.project_id`];
    case 'cycle':
      return [sql`cycle.starts_at desc nulls last`, sql`issues.cycle_id`];
    case 'team':
      return [sql`teams.sort_order`, sql`teams.key`];
    default:
      return [];
  }
}

export function orderSql(order: FilterOrder[]): SQL[] {
  const out: SQL[] = [];
  for (const o of order) {
    const dir = o.direction === 'desc' ? sql`desc` : sql`asc`;
    switch (o.field) {
      case 'priority':
        out.push(sql`issues.priority ${dir}`);
        break;
      case 'status':
        out.push(sql`${CATEGORY_RANK_SQL} ${dir}`, sql`statuses."order" ${dir}`);
        break;
      case 'createdAt':
        out.push(sql`issues.created_at ${dir}`);
        break;
      case 'updatedAt':
        out.push(sql`issues.updated_at ${dir}`);
        break;
      case 'completedAt':
        out.push(sql`issues.completed_at ${dir} nulls last`);
        break;
      case 'estimate':
        out.push(sql`issues.estimate ${dir} nulls last`);
        break;
      case 'manual':
        out.push(sql`issues.sort_order ${dir}`);
        break;
      case 'title':
        out.push(sql`lower(issues.title) ${dir}`);
        break;
      case 'identifier':
        out.push(sql`teams.key ${dir}`, sql`issues.number ${dir}`);
        break;
    }
  }
  return out;
}

/** Display ordering names (SPEC §3.10) → DSL order terms. */
export function displayOrdering(ordering: string | null | undefined): FilterOrder[] {
  switch (ordering) {
    case 'status':
      return [{ field: 'status', direction: 'asc' }, { field: 'priority', direction: 'asc' }];
    case 'created':
      return [{ field: 'createdAt', direction: 'desc' }];
    case 'updated':
      return [{ field: 'updatedAt', direction: 'desc' }];
    case 'estimate':
      return [{ field: 'estimate', direction: 'desc' }];
    case 'manual':
      return [{ field: 'manual', direction: 'asc' }];
    case 'priority':
    default:
      return [{ field: 'priority', direction: 'asc' }, { field: 'updatedAt', direction: 'desc' }];
  }
}
