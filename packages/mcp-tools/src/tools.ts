import { z } from 'zod';
import { mergeDsl, quoteDslValue } from './dsl';
import { ToolError, toToolError } from './errors';
import type { GraphQLExecutor } from './executor';
import {
  detailData,
  issueHeader,
  issueLine,
  renderIssueDetail,
  summarizeIssue,
  truncate,
} from './format';
import type { IssueCore, IssueDetail } from './format';
import * as ops from './operations';

// ---------------------------------------------------------------- shared schema pieces

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const ISSUE_URL_RE = /\/issue\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Normalize an identifier (ENG-123, case-insensitive), UUID or issue URL into what the API accepts. */
export function normalizeIssueRef(ref: string): string {
  const s = ref.trim();
  const url = ISSUE_URL_RE.exec(s);
  if (url?.[1]) return url[1];
  if (IDENTIFIER_RE.test(s)) return s.toUpperCase();
  return s;
}

function isIssueRef(s: string): boolean {
  const n = normalizeIssueRef(s);
  return UUID_RE.test(n) || IDENTIFIER_RE.test(n);
}

const issueRef = z
  .string()
  .max(300)
  .refine(isIssueRef, { message: 'Expected an issue identifier like ENG-123, a UUID, or an issue URL.' });

const PRIORITY_BY_NAME: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
  no_priority: 4,
  'no priority': 4,
};

/** 0-4 or a name (urgent/high/medium/low/none) → API integer. */
export function parsePriority(p: number | string): number | null {
  if (typeof p === 'number') return Number.isInteger(p) && p >= 0 && p <= 4 ? p : null;
  const t = p.trim().toLowerCase();
  if (/^[0-4]$/.test(t)) return Number(t);
  return PRIORITY_BY_NAME[t] ?? null;
}

const priority = z
  .union([z.number().int().min(0).max(4), z.string().refine((s) => parsePriority(s) !== null, { message: 'Priority must be 0-4 or one of: urgent, high, medium, low, none.' })])
  .describe('0 Urgent, 1 High, 2 Medium, 3 Low, 4 No priority; or the name (urgent|high|medium|low|none)');

const teamKey = z
  .string()
  .min(1)
  .max(10)
  .regex(/^[A-Za-z][A-Za-z0-9]*$/, 'Team keys are letters/digits, e.g. ENG. Use list_teams to see them.');

const labelNames = z.array(z.string().min(1).max(100)).max(50);
const dsl = z.string().max(2000).describe('Filter DSL (same parser as the UI), e.g. `assignee:me and priority lt:2 order:priority asc`');
const uuid = z.string().regex(UUID_RE, 'Expected a UUID.');

// ---------------------------------------------------------------- tool plumbing

export interface ToolOutput {
  text: string;
  data: Record<string, unknown>;
}

export interface ToolContext {
  /** Runs a document; throws ToolError on GraphQL errors. */
  gql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  /** Raw zod shape (what McpServer.registerTool expects). */
  shape: z.ZodRawShape;
  readOnly: boolean;
  /** Validates `args` against `shape`, then runs. Throws ToolError. */
  run(args: unknown, ctx: ToolContext): Promise<ToolOutput>;
}

function defineTool<S extends z.ZodRawShape>(def: {
  name: string;
  title: string;
  description: string;
  shape: S;
  readOnly: boolean;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<ToolOutput>;
}): ToolDefinition {
  const schema = z.object(def.shape);
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    shape: def.shape,
    readOnly: def.readOnly,
    async run(args, ctx) {
      const parsed = schema.safeParse(args ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`).join('; ');
        throw new ToolError(`VALIDATION: Invalid input for ${def.name}: ${issues}`, 'VALIDATION');
      }
      return def.handler(parsed.data, ctx);
    },
  };
}

export function createToolContext(executor: GraphQLExecutor): ToolContext {
  return {
    async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      let res: Awaited<ReturnType<GraphQLExecutor>>;
      try {
        res = await executor(query, variables);
      } catch (e) {
        throw new ToolError(`Could not reach the Velocity server: ${e instanceof Error ? e.message : String(e)}`, 'UNAVAILABLE');
      }
      if (res.errors && res.errors.length > 0) throw toToolError(res.errors);
      return res.data as T;
    },
  };
}

// ---------------------------------------------------------------- resolvers

interface ResolvedIssue {
  id: string;
  identifier: string;
  title: string;
  status: { id: string; name: string; category: string };
  labels: { id: string; name: string }[];
  team: { id: string; key: string; name: string; statuses: { id: string; name: string; category: string }[] };
}

async function resolveIssue(ctx: ToolContext, ref: string): Promise<ResolvedIssue> {
  const norm = normalizeIssueRef(ref);
  const data = await ctx.gql<{ issue: ResolvedIssue | null }>(ops.RESOLVE_ISSUE, { id: norm });
  if (!data.issue) throw new ToolError(`NOT_FOUND: No issue "${ref}". Check the identifier (e.g. ENG-123) with search_issues or list_issues.`, 'NOT_FOUND');
  return data.issue;
}

function resolveStatusName(team: ResolvedIssue['team'], name: string): { id: string; name: string } {
  const want = name.trim().toLowerCase();
  const hit = team.statuses.find((s) => s.name.toLowerCase() === want);
  if (!hit) {
    throw new ToolError(
      `VALIDATION: Team ${team.key} has no status named "${name}". Valid statuses: ${team.statuses.map((s) => `"${s.name}" (${s.category})`).join(', ')}.`,
      'VALIDATION',
    );
  }
  return hit;
}

async function resolveLabels(ctx: ToolContext, names: string[]): Promise<{ id: string; name: string }[]> {
  const data = await ctx.gql<{ labels: { id: string; name: string; isGroup: boolean }[] }>(ops.LABELS);
  const byName = new Map(data.labels.map((l) => [l.name.toLowerCase(), l]));
  const missing: string[] = [];
  const out: { id: string; name: string }[] = [];
  for (const n of names) {
    const hit = byName.get(n.trim().toLowerCase());
    if (!hit) missing.push(n);
    else if (!out.some((o) => o.id === hit.id)) out.push({ id: hit.id, name: hit.name });
  }
  if (missing.length > 0) {
    throw new ToolError(
      `VALIDATION: Unknown label${missing.length > 1 ? 's' : ''}: ${missing.map((m) => `"${m}"`).join(', ')}. Available labels: ${data.labels.map((l) => l.name).join(', ') || '(none)'}.`,
      'VALIDATION',
    );
  }
  return out;
}

async function resolveAssignee(ctx: ToolContext, who: string): Promise<{ id: string; username: string }> {
  const t = who.trim().replace(/^@/, '');
  if (t.toLowerCase() === 'me') {
    const v = await ctx.gql<{ viewer: { id: string; username: string } | null }>(ops.VIEWER);
    if (!v.viewer) throw new ToolError('UNAUTHENTICATED: Cannot resolve "me" without an authenticated user.', 'UNAUTHENTICATED');
    return v.viewer;
  }
  const data = await ctx.gql<{ users: { id: string; username: string }[] }>(ops.USERS);
  const hit = data.users.find((u) => u.username.toLowerCase() === t.toLowerCase());
  if (!hit) {
    throw new ToolError(`VALIDATION: No member with username "${who}". Members: ${data.users.map((u) => u.username).join(', ')}. Use "me" for yourself.`, 'VALIDATION');
  }
  return hit;
}

async function resolveTeam(ctx: ToolContext, key: string) {
  const data = await ctx.gql<{ team: { id: string; key: string; name: string; statuses: { id: string; name: string; category: string }[] } | null }>(ops.TEAM_BY_KEY, { key: key.toUpperCase() });
  if (!data.team) {
    const all = await ctx.gql<{ teams: { key: string; name: string }[] }>(ops.ALL_TEAM_KEYS);
    throw new ToolError(`NOT_FOUND: No team with key "${key}". Available teams: ${all.teams.map((t) => `${t.key} (${t.name})`).join(', ') || '(none)'}.`, 'NOT_FOUND');
  }
  return data.team;
}

async function validateDsl(ctx: ToolContext, text: string): Promise<void> {
  const r = await ctx.gql<{ parseFilter: { ok: boolean; error: { message: string; caret: string } | null } }>(ops.PARSE_FILTER, { dsl: text });
  if (!r.parseFilter.ok && r.parseFilter.error) {
    const { message, caret } = r.parseFilter.error;
    throw new ToolError(`VALIDATION: ${message}\n\n${caret}\n\nFix the filter_dsl at the caret and retry (see the velocity_guide prompt for the DSL cheat sheet).`, 'VALIDATION', caret);
  }
}

function issueResult(prefix: string, i: IssueCore): ToolOutput {
  const s = summarizeIssue(i);
  return { text: `${prefix} ${issueHeader(s)}`, data: { issue: s } };
}

// ---------------------------------------------------------------- tools

const createIssue = defineTool({
  name: 'create_issue',
  title: 'Create issue',
  description:
    'Create an issue in a team. Use list_teams first to get valid team keys, status names and label names. Created in the team default status unless `status` is given. Returns the canonical identifier (e.g. ENG-123).',
  readOnly: false,
  shape: {
    team_key: teamKey,
    title: z.string().trim().min(1).max(500),
    description: z.string().max(100_000).optional().describe('Markdown'),
    priority: priority.optional(),
    labels: labelNames.optional().describe('Label names (resolved to ids)'),
    assignee: z.string().min(1).max(100).optional().describe('Username or "me"'),
    status: z.string().min(1).max(100).optional().describe('Status name, e.g. "In Progress"'),
    estimate: z.number().int().min(0).max(40).optional(),
    project_id: uuid.optional(),
    cycle_id: uuid.optional(),
    parent: issueRef.optional().describe('Parent issue identifier, makes this a sub-issue'),
  },
  async handler(a, ctx) {
    const team = await resolveTeam(ctx, a.team_key);
    const input: Record<string, unknown> = { teamKey: team.key, title: a.title };
    if (a.description !== undefined) input.descriptionMd = a.description;
    if (a.priority !== undefined) input.priority = parsePriority(a.priority);
    if (a.estimate !== undefined) input.estimate = a.estimate;
    if (a.status !== undefined) input.statusId = resolveStatusName({ ...team }, a.status).id;
    if (a.labels && a.labels.length > 0) input.labelIds = (await resolveLabels(ctx, a.labels)).map((l) => l.id);
    if (a.assignee !== undefined) input.assigneeId = (await resolveAssignee(ctx, a.assignee)).id;
    if (a.project_id) input.projectId = a.project_id;
    if (a.cycle_id) input.cycleId = a.cycle_id;
    if (a.parent) input.parentId = (await resolveIssue(ctx, a.parent)).id;
    const d = await ctx.gql<{ createIssue: IssueCore }>(ops.CREATE_ISSUE, { input });
    return issueResult('Created', d.createIssue);
  },
});

const patchShape = {
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(100_000).optional().describe('Markdown; replaces the whole description'),
  priority: priority.optional(),
  estimate: z.number().int().min(0).max(40).nullable().optional().describe('null clears'),
  assignee: z.string().min(1).max(100).nullable().optional().describe('Username, "me", or null to unassign'),
  status: z.string().min(1).max(100).optional().describe('Status name (validated against the issue team)'),
  labels: labelNames.optional().describe('Label names; REPLACES the whole label set (use manage_labels to add/remove)'),
  project_id: uuid.nullable().optional().describe('null removes from project'),
  milestone_id: uuid.nullable().optional(),
  cycle_id: uuid.nullable().optional().describe('null removes from cycle'),
  parent: issueRef.nullable().optional().describe('Parent identifier, or null to detach'),
};

const updateIssue = defineTool({
  name: 'update_issue',
  title: 'Update issue',
  description:
    'Patch any issue properties in one call. Provide issue_id (identifier like ENG-123, or UUID) and a `patch` object with only the fields to change. Prefer set_status / assign_issue / manage_labels for single-property changes.',
  readOnly: false,
  shape: {
    issue_id: issueRef.optional().describe('Identifier (ENG-123) or UUID'),
    identifier: issueRef.optional().describe('Alias of issue_id'),
    patch: z.object(patchShape),
    expected_updated_at: z.string().max(40).optional().describe('Optimistic concurrency guard: fails with CONFLICT if the issue changed since this updatedAt'),
  },
  async handler(a, ctx) {
    const ref = a.issue_id ?? a.identifier;
    if (!ref) throw new ToolError('VALIDATION: Provide issue_id (or identifier), e.g. "ENG-123".', 'VALIDATION');
    const p = a.patch;
    if (Object.values(p).every((v) => v === undefined)) {
      throw new ToolError('VALIDATION: patch is empty. Provide at least one of: title, description, priority, estimate, assignee, status, labels, project_id, milestone_id, cycle_id, parent.', 'VALIDATION');
    }
    const issue = await resolveIssue(ctx, ref);
    const input: Record<string, unknown> = {};
    if (p.title !== undefined) input.title = p.title;
    if (p.description !== undefined) input.descriptionMd = p.description;
    if (p.priority !== undefined) input.priority = parsePriority(p.priority);
    if (p.estimate !== undefined) input.estimate = p.estimate;
    if (p.status !== undefined) input.statusId = resolveStatusName(issue.team, p.status).id;
    if (p.assignee !== undefined) input.assigneeId = p.assignee === null ? null : (await resolveAssignee(ctx, p.assignee)).id;
    if (p.labels !== undefined) input.labelIds = (await resolveLabels(ctx, p.labels)).map((l) => l.id);
    if (p.project_id !== undefined) input.projectId = p.project_id;
    if (p.milestone_id !== undefined) input.milestoneId = p.milestone_id;
    if (p.cycle_id !== undefined) input.cycleId = p.cycle_id;
    if (p.parent !== undefined) input.parentId = p.parent === null ? null : (await resolveIssue(ctx, p.parent)).id;
    const d = await ctx.gql<{ updateIssue: IssueCore }>(ops.UPDATE_ISSUE, {
      id: issue.id,
      input,
      ...(a.expected_updated_at ? { expectedUpdatedAt: a.expected_updated_at } : {}),
    });
    return issueResult('Updated', d.updateIssue);
  },
});

const getIssue = defineTool({
  name: 'get_issue',
  title: 'Get issue',
  description:
    'Full issue detail by identifier (ENG-123) or UUID: description, status, labels, assignee, comments, relations, linked pull requests, sub-issues and URL. Read an issue before changing it.',
  readOnly: true,
  shape: { identifier: issueRef.optional(), id: issueRef.optional() },
  async handler(a, ctx) {
    const ref = a.identifier ?? a.id;
    if (!ref) throw new ToolError('VALIDATION: Provide identifier (e.g. "ENG-123") or id.', 'VALIDATION');
    const d = await ctx.gql<{ issue: IssueDetail | null }>(ops.GET_ISSUE, { id: normalizeIssueRef(ref) });
    if (!d.issue) throw new ToolError(`NOT_FOUND: No issue "${ref}". Check the identifier with search_issues or list_issues.`, 'NOT_FOUND');
    return { text: renderIssueDetail(d.issue), data: { issue: detailData(d.issue) } };
  },
});

const searchIssues = defineTool({
  name: 'search_issues',
  title: 'Search issues',
  description:
    'Full-text search over issues (same engine as the UI search). Optional filter_dsl narrows the hits (intersection). Results are ranked, compact, and include identifiers.',
  readOnly: true,
  shape: {
    query: z.string().trim().min(1).max(500),
    filter_dsl: dsl.optional(),
    limit: z.number().int().min(1).max(100).optional().describe('Default 20'),
  },
  async handler(a, ctx) {
    const limit = a.limit ?? 20;
    const dslText = a.filter_dsl?.trim() ? a.filter_dsl.trim() : undefined;
    if (dslText) await validateDsl(ctx, dslText);
    const s = await ctx.gql<{ search: { rank: number; issue: IssueCore | null }[] }>(ops.SEARCH_ISSUES, {
      query: a.query,
      limit: dslText ? 100 : limit,
    });
    let hits = s.search.filter((r): r is { rank: number; issue: IssueCore } => r.issue !== null).map((r) => r.issue);
    if (dslText && hits.length > 0) {
      const merged = mergeDsl(dslText, [`identifier in:${hits.map((h) => h.identifier).join(',')}`]);
      const l = await ctx.gql<{ issues: { nodes: IssueCore[] } }>(ops.LIST_ISSUES, { filter: merged, first: 100 });
      const keep = new Set(l.issues.nodes.map((n) => n.id));
      hits = hits.filter((h) => keep.has(h.id));
    }
    const issues = hits.slice(0, limit).map(summarizeIssue);
    const text = issues.length === 0 ? `No issues match "${a.query}"${dslText ? ` with filter ${dslText}` : ''}.` : `${issues.length} result(s) for "${a.query}":\n${issues.map(issueLine).join('\n')}`;
    return { text, data: { query: a.query, count: issues.length, issues } };
  },
});

const listIssues = defineTool({
  name: 'list_issues',
  title: 'List issues',
  description:
    'List issues (50 per page) with the filter DSL. `status` and `assignee` are merged into the DSL as `status:"…"` and `assignee:…`. Pass the returned next_cursor as `cursor` for the next page.',
  readOnly: true,
  shape: {
    team_key: teamKey.optional().describe('Restrict to one team'),
    filter_dsl: dsl.optional(),
    status: z.string().min(1).max(100).optional().describe('Status name, e.g. "In Progress"'),
    assignee: z.string().min(1).max(100).optional().describe('Username, "me", or "empty" for unassigned'),
    cursor: z.string().min(1).max(500).optional(),
    limit: z.number().int().min(1).max(50).optional().describe('Page size, default 50'),
  },
  async handler(a, ctx) {
    const extras: string[] = [];
    if (a.status) extras.push(`status:${quoteDslValue(a.status)}`);
    if (a.assignee) {
      const w = a.assignee.trim().replace(/^@/, '');
      extras.push(w.toLowerCase() === 'me' ? 'assignee:me' : w.toLowerCase() === 'empty' ? 'assignee:empty' : `assignee:${quoteDslValue(w)}`);
    }
    const filter = mergeDsl(a.filter_dsl?.trim(), extras);
    const d = await ctx.gql<{ issues: { totalCount: number; pageInfo: { endCursor: string | null; hasNextPage: boolean }; nodes: IssueCore[] } }>(ops.LIST_ISSUES, {
      filter: filter ?? null,
      teamKey: a.team_key ? a.team_key.toUpperCase() : null,
      first: a.limit ?? 50,
      after: a.cursor ?? null,
    });
    const issues = d.issues.nodes.map(summarizeIssue);
    const next = d.issues.pageInfo.hasNextPage ? d.issues.pageInfo.endCursor : null;
    const head = `${issues.length} of ${d.issues.totalCount} issue(s)${filter ? ` for ${filter}` : ''}`;
    const text = issues.length === 0 ? `No issues found${filter ? ` for ${filter}` : ''}.` : `${head}:\n${issues.map(issueLine).join('\n')}${next ? `\n\nMore available: call list_issues again with cursor "${next}".` : ''}`;
    return { text, data: { totalCount: d.issues.totalCount, count: issues.length, next_cursor: next, filter: filter ?? null, issues } };
  },
});

const addComment = defineTool({
  name: 'add_comment',
  title: 'Add comment',
  description: 'Post a Markdown comment on an issue as the API key owner. Do not spam: one consolidated comment is better than many.',
  readOnly: false,
  shape: { identifier: issueRef, body_md: z.string().trim().min(1).max(50_000) },
  async handler(a, ctx) {
    const issue = await resolveIssue(ctx, a.identifier);
    const d = await ctx.gql<{ createComment: { id: string; bodyMd: string; createdAt: string; author: { username: string } | null; issue: { identifier: string; url: string } } }>(ops.ADD_COMMENT, {
      issueId: issue.id,
      bodyMd: a.body_md,
    });
    const c = d.createComment;
    return {
      text: `Commented on ${c.issue.identifier} as @${c.author?.username ?? 'unknown'}.\n${c.issue.url}`,
      data: { comment: { id: c.id, issue: c.issue.identifier, url: c.issue.url, author: c.author?.username ?? null, createdAt: c.createdAt } },
    };
  },
});

const manageLabels = defineTool({
  name: 'manage_labels',
  title: 'Add or remove labels',
  description: 'Add or remove labels (by name) on an issue without touching its other labels. Unknown names produce an error listing the available labels.',
  readOnly: false,
  shape: {
    action: z.enum(['add', 'remove']),
    identifier: issueRef,
    labels: labelNames.optional(),
    label: z.string().min(1).max(100).optional().describe('Single label name (alternative to labels)'),
  },
  async handler(a, ctx) {
    const names = [...(a.labels ?? []), ...(a.label ? [a.label] : [])];
    if (names.length === 0) throw new ToolError('VALIDATION: Provide labels (array of names) or label.', 'VALIDATION');
    const issue = await resolveIssue(ctx, a.identifier);
    const labels = await resolveLabels(ctx, names);
    const input = a.action === 'add' ? { addLabelIds: labels.map((l) => l.id) } : { removeLabelIds: labels.map((l) => l.id) };
    const d = await ctx.gql<{ updateIssue: IssueCore }>(ops.UPDATE_ISSUE, { id: issue.id, input });
    return issueResult(`${a.action === 'add' ? 'Added' : 'Removed'} ${labels.map((l) => l.name).join(', ')} on`, d.updateIssue);
  },
});

const setStatus = defineTool({
  name: 'set_status',
  title: 'Set status',
  description: "Move an issue to a workflow status by name (case-insensitive), validated against the issue's team workflow. Errors list the valid names. Prefer this over editing descriptions to report progress.",
  readOnly: false,
  shape: { identifier: issueRef, status_name: z.string().trim().min(1).max(100) },
  async handler(a, ctx) {
    const issue = await resolveIssue(ctx, a.identifier);
    const status = resolveStatusName(issue.team, a.status_name);
    const d = await ctx.gql<{ updateIssue: IssueCore }>(ops.UPDATE_ISSUE, { id: issue.id, input: { statusId: status.id } });
    return issueResult(`Status set to "${status.name}" on`, d.updateIssue);
  },
});

const assignIssue = defineTool({
  name: 'assign_issue',
  title: 'Assign issue',
  description: 'Assign an issue to a member by username, to yourself with "me", or pass null to unassign.',
  readOnly: false,
  shape: { identifier: issueRef, assignee: z.string().min(1).max(100).nullable().describe('Username, "me", or null to unassign') },
  async handler(a, ctx) {
    const issue = await resolveIssue(ctx, a.identifier);
    const assigneeId = a.assignee === null ? null : (await resolveAssignee(ctx, a.assignee)).id;
    const d = await ctx.gql<{ updateIssue: IssueCore }>(ops.UPDATE_ISSUE, { id: issue.id, input: { assigneeId } });
    return issueResult(a.assignee === null ? 'Unassigned' : 'Assigned', d.updateIssue);
  },
});

interface TeamsPayload {
  teams: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    cycleEnabled: boolean;
    estimateScale: string;
    openIssueCount: number;
    statuses: { id: string; name: string; category: string }[];
    members: { username: string; name: string }[];
  }[];
  labels: { id: string; name: string; isGroup: boolean }[];
}

const listTeams = defineTool({
  name: 'list_teams',
  title: 'List teams',
  description: 'Teams with their keys, workflow statuses (with categories) and member usernames, plus workspace labels. Call this before creating issues.',
  readOnly: true,
  shape: {},
  async handler(_a, ctx) {
    const d = await ctx.gql<TeamsPayload>(ops.LIST_TEAMS);
    const teams = d.teams.map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description ? truncate(t.description, 200) : null,
      cycleEnabled: t.cycleEnabled,
      estimateScale: t.estimateScale,
      openIssueCount: t.openIssueCount,
      statuses: t.statuses.map((s) => ({ name: s.name, category: s.category })),
      members: t.members.map((m) => m.username),
    }));
    const labels = d.labels.filter((l) => !l.isGroup).map((l) => l.name);
    const text = [
      ...teams.map(
        (t) =>
          `${t.key} - ${t.name} (${t.openIssueCount} open${t.cycleEnabled ? ', cycles on' : ''})\n  statuses: ${t.statuses.map((s) => `${s.name} [${s.category}]`).join(', ')}\n  members: ${t.members.join(', ') || '(none)'}`,
      ),
      `Labels: ${labels.join(', ') || '(none)'}`,
    ].join('\n');
    return { text: teams.length === 0 ? 'No teams yet.' : text, data: { teams, labels } };
  },
});

interface CycleRow {
  id: string;
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
  closedAt: string | null;
  isActive: boolean;
  isUpcoming: boolean;
  team: { key: string };
  stats: Record<string, number> | null;
  liveStats: Record<string, number>;
}

const listCycles = defineTool({
  name: 'list_cycles',
  title: 'List cycles',
  description: 'Active, upcoming and recent cycles for a team with stats (closed cycles) and liveStats (current scope/progress).',
  readOnly: true,
  shape: { team_key: teamKey, limit: z.number().int().min(1).max(30).optional().describe('Default 8') },
  async handler(a, ctx) {
    const key = a.team_key.toUpperCase();
    await resolveTeam(ctx, key);
    const d = await ctx.gql<{ cycles: CycleRow[] }>(ops.LIST_CYCLES, { teamKey: key, first: a.limit ?? 8 });
    const cycles = d.cycles.map((c) => ({
      id: c.id,
      number: c.number,
      name: c.name,
      state: c.isActive ? 'active' : c.isUpcoming ? 'upcoming' : 'closed',
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      closedAt: c.closedAt,
      stats: c.stats,
      liveStats: c.liveStats,
    }));
    const lines = cycles.map((c) => {
      const s = c.stats ?? c.liveStats;
      return `#${c.number} ${c.name} [${c.state}] ${c.startsAt.slice(0, 10)}..${c.endsAt.slice(0, 10)} - ${s.completedCount ?? 0}/${s.scopeCount ?? 0} issues, ${s.completedPoints ?? 0}/${s.scopePoints ?? 0} pts`;
    });
    return { text: cycles.length === 0 ? `Team ${key} has no cycles (cycles may be disabled).` : lines.join('\n'), data: { team: key, cycles } };
  },
});

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  health: string | null;
  targetDate: string | null;
  url: string;
  archivedAt: string | null;
  lead: { username: string; name: string } | null;
  teams: { key: string; name: string }[];
  progress: { done: number; total: number; percent: number; pointsDone: number; pointsTotal: number };
}
interface ProjectDetail extends ProjectRow {
  descriptionMd: string;
  milestones: { id: string; name: string; status: string; targetDate: string | null; description: string | null; progress: ProjectRow['progress'] }[];
}

function projectSummary(p: ProjectRow) {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    health: p.health,
    targetDate: p.targetDate,
    lead: p.lead?.username ?? null,
    teams: p.teams.map((t) => t.key),
    progress: p.progress,
    url: p.url,
  };
}

function projectLine(p: ReturnType<typeof projectSummary>): string {
  return `${p.name} [${p.status}${p.health ? `, ${p.health}` : ''}] ${p.progress.done}/${p.progress.total} issues (${Math.round(p.progress.percent)}%)${p.teams.length ? ` teams: ${p.teams.join(',')}` : ''} id=${p.id}`;
}

const getProject = defineTool({
  name: 'get_project',
  title: 'Get project',
  description: 'Project detail with milestones and progress. `id` is the project UUID (from list_projects) or the exact project name.',
  readOnly: true,
  shape: { id: z.string().trim().min(1).max(200) },
  async handler(a, ctx) {
    let id = a.id;
    if (!UUID_RE.test(id)) {
      const all = await ctx.gql<{ projects: ProjectRow[] }>(ops.LIST_PROJECTS, { includeArchived: true });
      const hit = all.projects.find((p) => p.name.toLowerCase() === a.id.toLowerCase());
      if (!hit) throw new ToolError(`NOT_FOUND: No project named "${a.id}". Projects: ${all.projects.map((p) => p.name).join(', ') || '(none)'}.`, 'NOT_FOUND');
      id = hit.id;
    }
    const d = await ctx.gql<{ project: ProjectDetail | null }>(ops.GET_PROJECT, { id });
    if (!d.project) throw new ToolError(`NOT_FOUND: No project "${a.id}". Use list_projects to see ids.`, 'NOT_FOUND');
    const p = d.project;
    const summary = projectSummary(p);
    const milestones = p.milestones.map((m) => ({ id: m.id, name: m.name, status: m.status, targetDate: m.targetDate, progress: m.progress }));
    const text = [
      projectLine(summary),
      p.url,
      ...(p.descriptionMd.trim() ? ['', truncate(p.descriptionMd, 1500)] : []),
      ...(milestones.length ? ['', 'Milestones:', ...milestones.map((m) => `- ${m.name} [${m.status}]${m.targetDate ? ` due ${m.targetDate}` : ''} ${m.progress.done}/${m.progress.total}`)] : []),
    ].join('\n');
    return { text, data: { project: { ...summary, description: p.descriptionMd, milestones } } };
  },
});

const PROJECT_STATUS = z.enum(['planned', 'in_progress', 'completed', 'canceled']);

const listProjects = defineTool({
  name: 'list_projects',
  title: 'List projects',
  description: 'Projects with status and progress, optionally filtered by status or team key.',
  readOnly: true,
  shape: { status: PROJECT_STATUS.optional(), team_key: teamKey.optional() },
  async handler(a, ctx) {
    const vars: Record<string, unknown> = {};
    if (a.status) vars.status = [a.status];
    if (a.team_key) vars.teamId = (await resolveTeam(ctx, a.team_key)).id;
    const d = await ctx.gql<{ projects: ProjectRow[] }>(ops.LIST_PROJECTS, vars);
    const projects = d.projects.map(projectSummary);
    return { text: projects.length === 0 ? 'No projects found.' : projects.map(projectLine).join('\n'), data: { count: projects.length, projects } };
  },
});

/** The 13 tools of SPEC §6.6.1. */
export const toolDefinitions: ToolDefinition[] = [
  createIssue,
  updateIssue,
  getIssue,
  searchIssues,
  listIssues,
  addComment,
  manageLabels,
  setStatus,
  assignIssue,
  listTeams,
  listCycles,
  getProject,
  listProjects,
];

