import type { ImportBundle, ImportIssue, ProjectStatus, StatusCategory } from '@velocity/schema';
import { mapLinearApiPriority } from './infer';
import { Collector, RelationResolver, normalizeEstimate, parseDate, sanitizeKey } from './util';

export interface LinearApiOptions {
  apiKey: string;
  fetch?: typeof fetch;
  teamKeys?: string[];
  onProgress?: (done: number, total?: number) => void;
  /** Issues per page (default 100). */
  pageSize?: number;
}

const ENDPOINT = 'https://api.linear.app/graphql';

const STATE_CATEGORY: Record<string, StatusCategory> = {
  backlog: 'backlog',
  unstarted: 'todo',
  started: 'in_progress',
  completed: 'done',
  canceled: 'canceled',
  triage: 'backlog',
};

const PROJECT_STATUS: Record<string, ProjectStatus> = {
  backlog: 'planned',
  planned: 'planned',
  started: 'in_progress',
  paused: 'in_progress',
  completed: 'completed',
  canceled: 'canceled',
};

interface Connection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

const Q = {
  teams: `query Teams($first: Int!, $after: String) { teams(first: $first, after: $after) { nodes { id key name states { nodes { name type } } } pageInfo { hasNextPage endCursor } } }`,
  users: `query Users($first: Int!, $after: String) { users(first: $first, after: $after) { nodes { id name email displayName } pageInfo { hasNextPage endCursor } } }`,
  labels: `query Labels($first: Int!, $after: String) { issueLabels(first: $first, after: $after) { nodes { name parent { name } } pageInfo { hasNextPage endCursor } } }`,
  projects: `query Projects($first: Int!, $after: String) { projects(first: $first, after: $after) { nodes { id name description state targetDate lead { id } projectMilestones { nodes { id name targetDate } } } pageInfo { hasNextPage endCursor } } }`,
  cycles: `query Cycles($first: Int!, $after: String) { cycles(first: $first, after: $after) { nodes { id number name startsAt endsAt team { id } } pageInfo { hasNextPage endCursor } } }`,
  issues: `query Issues($first: Int!, $after: String, $filter: IssueFilter) { issues(first: $first, after: $after, filter: $filter, includeArchived: true) { nodes { id identifier title description priority estimate state { name type } team { id } assignee { id } creator { id } labels { nodes { name } } project { id } projectMilestone { id } cycle { id } parent { identifier } relations { nodes { type relatedIssue { identifier } } } comments { nodes { body createdAt user { id name } } } attachments { nodes { title url } } createdAt updatedAt completedAt canceledAt archivedAt } pageInfo { hasNextPage endCursor } } }`,
};

interface TeamNode {
  id: string;
  key: string;
  name: string;
  states?: { nodes: { name: string; type: string }[] };
}
interface UserNode {
  id: string;
  name: string;
  email?: string | null;
  displayName?: string | null;
}
interface LabelNode {
  name: string;
  parent?: { name: string } | null;
}
interface ProjectNode {
  id: string;
  name: string;
  description?: string | null;
  state?: string | null;
  targetDate?: string | null;
  lead?: { id: string } | null;
  projectMilestones?: { nodes: { id: string; name: string; targetDate?: string | null }[] };
}
interface CycleNode {
  id: string;
  number: number;
  name?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  team?: { id: string } | null;
}
interface IssueNode {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number | null;
  estimate?: number | null;
  state?: { name: string; type: string } | null;
  team?: { id: string } | null;
  assignee?: { id: string } | null;
  creator?: { id: string } | null;
  labels?: { nodes: { name: string }[] };
  project?: { id: string } | null;
  projectMilestone?: { id: string } | null;
  cycle?: { id: string } | null;
  parent?: { identifier: string } | null;
  relations?: { nodes: { type: string; relatedIssue?: { identifier: string } | null }[] };
  comments?: { nodes: { body: string; createdAt?: string | null; user?: { id: string; name: string } | null }[] };
  attachments?: { nodes: { title?: string | null; url: string }[] };
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  canceledAt?: string | null;
  archivedAt?: string | null;
}

/** Fetch a Linear workspace through its public GraphQL API. The API key is used in memory only. */
export async function fetchLinearApi(opts: LinearApiOptions): Promise<ImportBundle> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const pageSize = opts.pageSize ?? 100;
  const c = new Collector();

  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await doFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: opts.apiKey },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json().catch(() => null)) as {
      data?: T;
      errors?: { message?: string; extensions?: { code?: string } }[];
    } | null;
    const err = body?.errors?.[0];
    if (err || !res.ok || !body?.data) {
      if (res.status === 429 || err?.extensions?.code === 'RATELIMITED') {
        throw new Error('Linear API rate limit reached; wait a while and try again');
      }
      if (res.status === 401) throw new Error('Linear rejected the API key (401 Unauthorized)');
      throw new Error(`Linear API error: ${err?.message ?? `HTTP ${res.status}`}`);
    }
    return body.data;
  }

  async function* pages<N>(
    query: string,
    field: string,
    extra: Record<string, unknown> = {},
    first = 100,
  ): AsyncGenerator<N[]> {
    let after: string | null = null;
    for (;;) {
      const data: Record<string, Connection<N>> = await gql(query, { first, after, ...extra });
      const conn: Connection<N> | undefined = data[field];
      if (!conn) throw new Error(`Linear API response is missing "${field}"`);
      yield conn.nodes;
      if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) return;
      after = conn.pageInfo.endCursor;
    }
  }

  const wanted = opts.teamKeys?.length ? new Set(opts.teamKeys.map((k) => k.toUpperCase())) : null;
  const teamIds = new Set<string>();

  for await (const nodes of pages<TeamNode>(Q.teams, 'teams')) {
    for (const t of nodes) {
      if (wanted && !wanted.has(t.key.toUpperCase())) continue;
      teamIds.add(t.id);
      c.teams.set(t.id, { externalId: t.id, key: sanitizeKey(t.key) || t.key, name: t.name });
      for (const s of t.states?.nodes ?? []) {
        c.addStatus({ teamExternalId: t.id, name: s.name, category: STATE_CATEGORY[s.type] ?? null });
      }
    }
  }
  if (wanted && teamIds.size === 0) {
    c.warn('no_matching_team', `None of the requested team keys (${[...wanted].join(', ')}) exist in this workspace`);
  }

  for await (const nodes of pages<UserNode>(Q.users, 'users')) {
    for (const u of nodes) {
      c.addUser({ externalId: u.id, name: u.name, email: u.email ?? null, username: u.displayName ?? null });
    }
  }
  for await (const nodes of pages<LabelNode>(Q.labels, 'issueLabels')) {
    for (const l of nodes) c.addLabel(l.name, l.parent?.name ?? null);
  }
  for await (const nodes of pages<ProjectNode>(Q.projects, 'projects')) {
    for (const p of nodes) {
      c.projects.set(p.id, {
        externalId: p.id,
        name: p.name,
        descriptionMd: p.description || null,
        status: p.state ? (PROJECT_STATUS[p.state] ?? null) : null,
        targetDate: p.targetDate ?? null,
        leadExternalId: p.lead?.id ?? null,
        milestones: (p.projectMilestones?.nodes ?? []).map((m) => ({
          externalId: m.id,
          name: m.name,
          targetDate: m.targetDate ?? null,
        })),
      });
    }
  }
  for await (const nodes of pages<CycleNode>(Q.cycles, 'cycles')) {
    for (const cy of nodes) {
      if (!cy.team || (wanted && !teamIds.has(cy.team.id))) continue;
      if (!cy.startsAt || !cy.endsAt) {
        c.warn('cycle_missing_dates', `Cycle ${cy.number} has no start/end dates; skipped`, cy.id);
        continue;
      }
      c.cycles.set(cy.id, {
        externalId: cy.id,
        teamExternalId: cy.team.id,
        number: cy.number,
        name: cy.name ?? null,
        startsAt: cy.startsAt,
        endsAt: cy.endsAt,
      });
    }
  }

  const rel = new RelationResolver();
  const filter = wanted ? { team: { key: { in: [...wanted] } } } : undefined;
  let done = 0;
  for await (const nodes of pages<IssueNode>(Q.issues, 'issues', { filter }, pageSize)) {
    for (const n of nodes) {
      if (!n.team?.id) {
        c.warn('missing_team', 'Issue has no team; skipped', n.identifier);
        continue;
      }
      if (!c.teams.has(n.team.id)) {
        if (wanted) continue;
        c.warn('missing_team', `Issue team ${n.team.id} is unknown; skipped`, n.identifier);
        continue;
      }
      const statusName = n.state?.name ?? 'Backlog';
      c.addStatus({
        teamExternalId: n.team.id,
        name: statusName,
        category: STATE_CATEGORY[n.state?.type ?? ''] ?? null,
      });
      const labelNames = (n.labels?.nodes ?? []).map((l) => l.name);
      for (const l of labelNames) c.addLabel(l);
      let estimate: number | null = null;
      if (typeof n.estimate === 'number') {
        const r = normalizeEstimate(n.estimate);
        estimate = r.value;
        if (r.clamped) c.warn('estimate_clamped', `Estimate ${n.estimate} clamped to ${r.value}`, n.identifier);
      }
      const priority = mapLinearApiPriority(n.priority ?? 0);
      const issue: ImportIssue = {
        externalId: n.identifier,
        teamExternalId: n.team.id,
        title: n.title,
        descriptionMd: n.description || null,
        statusName,
        priority,
        estimate,
        assigneeExternalId: n.assignee?.id ?? null,
        creatorExternalId: n.creator?.id ?? null,
        labelNames: [...new Set(labelNames)].slice(0, 10),
        projectExternalId: n.project?.id ?? null,
        milestoneExternalId: n.projectMilestone?.id ?? null,
        cycleExternalId: n.cycle?.id && c.cycles.has(n.cycle.id) ? n.cycle.id : null,
        parentExternalId: n.parent?.identifier ?? null,
        relations: [],
        comments: (n.comments?.nodes ?? []).map((cm) => ({
          authorExternalId: cm.user?.id ?? null,
          authorName: cm.user?.name ?? null,
          bodyMd: cm.body,
          createdAt: parseDate(cm.createdAt),
        })),
        createdAt: parseDate(n.createdAt),
        updatedAt: parseDate(n.updatedAt),
        completedAt: parseDate(n.completedAt),
        canceledAt: parseDate(n.canceledAt),
        archivedAt: parseDate(n.archivedAt),
        attachments: (n.attachments?.nodes ?? []).map((a) => ({ name: a.title || a.url, url: a.url })),
      };
      c.issues.push(issue);
      for (const r of n.relations?.nodes ?? []) {
        const target = r.relatedIssue?.identifier;
        if (!target) continue;
        if (r.type === 'blocks' || r.type === 'related' || r.type === 'duplicate') rel.add(n.identifier, r.type, target);
        else c.warn('unsupported_relation', `Relation type "${r.type}" is not supported; skipped`, n.identifier);
      }
    }
    done += nodes.length;
    opts.onProgress?.(done);
  }

  const ids = new Set(c.issues.map((i) => i.externalId));
  for (const i of c.issues) {
    if (i.parentExternalId && !ids.has(i.parentExternalId)) {
      c.warn('unknown_parent', `Parent ${i.parentExternalId} is not part of this import`, i.externalId);
      i.parentExternalId = null;
    }
  }
  rel.apply(c.issues, c);
  return c.toBundle('linear');
}
