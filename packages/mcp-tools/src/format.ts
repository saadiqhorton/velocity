/** Shared payload shapes and compact renderers (text + structured JSON). */

export interface IssueCore {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  estimate: number | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  status: { id: string; name: string; category: string };
  assignee: { id: string; username: string; name: string } | null;
  team: { id: string; key: string; name: string };
  labels: { id: string; name: string }[];
  project: { id: string; name: string } | null;
  cycle: { id: string; number: number; name: string } | null;
  parent: { identifier: string; title: string } | null;
}

export interface IssueDetail extends IssueCore {
  descriptionMd: string;
  creator: { id: string; username: string; name: string } | null;
  milestone: { id: string; name: string } | null;
  subIssueRollup: { done: number; total: number };
  children: { identifier: string; title: string; status: { name: string; category: string }; assignee: { username: string } | null }[];
  relations: { id: string; type: string; issue: { identifier: string; title: string; status: { name: string; category: string } } }[];
  githubLinks: {
    id: string;
    kind: string;
    repo: string;
    prNumber: number | null;
    title: string | null;
    state: string | null;
    url: string | null;
    headBranch: string | null;
    commitSha: string | null;
    mergedAt: string | null;
    closesIssue: boolean;
  }[];
  comments: {
    id: string;
    bodyMd: string;
    createdAt: string;
    editedAt: string | null;
    source: string;
    authorName: string | null;
    author: { username: string; name: string } | null;
  }[];
}

export const PRIORITY_NAMES = ['Urgent', 'High', 'Medium', 'Low', 'No priority'] as const;

export function priorityName(p: number): string {
  return PRIORITY_NAMES[p] ?? String(p);
}

export function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}

export function summarizeIssue(i: IssueCore) {
  return {
    identifier: i.identifier,
    id: i.id,
    title: i.title,
    status: i.status.name,
    statusCategory: i.status.category,
    priority: i.priority,
    priorityName: priorityName(i.priority),
    assignee: i.assignee?.username ?? null,
    labels: i.labels.map((l) => l.name),
    team: i.team.key,
    project: i.project?.name ?? null,
    cycle: i.cycle?.number ?? null,
    estimate: i.estimate,
    parent: i.parent?.identifier ?? null,
    url: i.url,
    updatedAt: i.updatedAt,
  };
}

export type IssueSummary = ReturnType<typeof summarizeIssue>;

export function issueLine(i: IssueSummary): string {
  const labels = i.labels.length > 0 ? ` {${i.labels.join(', ')}}` : '';
  return `${i.identifier} [${i.status}] ${i.priorityName} ${i.assignee ? `@${i.assignee}` : 'unassigned'}${labels} - ${truncate(i.title, 120)}`;
}

export function issueHeader(i: IssueSummary): string {
  return `${issueLine(i)}\n${i.url}`;
}

export function renderIssueDetail(d: IssueDetail): string {
  const s = summarizeIssue(d);
  const out: string[] = [];
  out.push(`${d.identifier}: ${d.title}`);
  out.push(d.url);
  out.push(
    `Status: ${s.status} (${s.statusCategory}) | Priority: ${s.priorityName} | Assignee: ${s.assignee ? `@${s.assignee}` : 'unassigned'} | Team: ${d.team.key}` +
      `${d.estimate !== null ? ` | Estimate: ${d.estimate}` : ''}`,
  );
  const meta: string[] = [];
  if (s.labels.length) meta.push(`Labels: ${s.labels.join(', ')}`);
  if (d.project) meta.push(`Project: ${d.project.name}`);
  if (d.milestone) meta.push(`Milestone: ${d.milestone.name}`);
  if (d.cycle) meta.push(`Cycle: ${d.cycle.number}`);
  if (d.parent) meta.push(`Parent: ${d.parent.identifier} ${truncate(d.parent.title, 80)}`);
  if (d.creator) meta.push(`Creator: @${d.creator.username}`);
  meta.push(`Updated: ${d.updatedAt}`);
  out.push(meta.join(' | '));
  out.push('', 'Description:', d.descriptionMd.trim() === '' ? '(none)' : d.descriptionMd.trim());
  if (d.children.length) {
    out.push('', `Sub-issues (${d.subIssueRollup.done}/${d.subIssueRollup.total} done):`);
    for (const c of d.children) out.push(`- ${c.identifier} [${c.status.name}] ${truncate(c.title, 100)}`);
  }
  if (d.relations.length) {
    out.push('', 'Relations:');
    for (const r of d.relations) out.push(`- ${r.type.replace(/_/g, ' ')} ${r.issue.identifier} [${r.issue.status.name}] ${truncate(r.issue.title, 100)}`);
  }
  if (d.githubLinks.length) {
    out.push('', 'Linked GitHub:');
    for (const g of d.githubLinks) {
      const ref = g.kind === 'pr' || g.prNumber ? `${g.repo}#${g.prNumber ?? '?'}` : `${g.repo}${g.commitSha ? `@${g.commitSha.slice(0, 7)}` : ''}`;
      out.push(`- ${g.kind} ${ref}${g.state ? ` (${g.state})` : ''}${g.title ? ` ${truncate(g.title, 80)}` : ''}${g.url ? ` ${g.url}` : ''}`);
    }
  }
  if (d.comments.length) {
    out.push('', `Comments (${d.comments.length}):`);
    for (const c of d.comments) {
      const who = c.author ? `@${c.author.username}` : (c.authorName ?? 'unknown');
      out.push(`- ${who} ${c.createdAt}: ${truncate(c.bodyMd, 600)}`);
    }
  }
  return out.join('\n');
}

export function detailData(d: IssueDetail) {
  return {
    ...summarizeIssue(d),
    description: d.descriptionMd,
    creator: d.creator?.username ?? null,
    milestone: d.milestone?.name ?? null,
    subIssueRollup: d.subIssueRollup,
    subIssues: d.children.map((c) => ({ identifier: c.identifier, title: c.title, status: c.status.name, statusCategory: c.status.category, assignee: c.assignee?.username ?? null })),
    relations: d.relations.map((r) => ({ type: r.type, identifier: r.issue.identifier, title: r.issue.title, status: r.issue.status.name })),
    linkedPullRequests: d.githubLinks,
    comments: d.comments.map((c) => ({
      id: c.id,
      author: c.author?.username ?? c.authorName ?? null,
      bodyMd: c.bodyMd,
      createdAt: c.createdAt,
      editedAt: c.editedAt,
      source: c.source,
    })),
    createdAt: d.createdAt,
    completedAt: d.completedAt,
  };
}
