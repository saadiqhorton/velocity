/**
 * "Copy as prompt" and "Copy branch name" (Roadmap v1.2 U2). Pure functions: the data
 * comes from the IssueDetail / IssueComments queries, so this module never fetches.
 */
import { m } from '@/i18n';

export const BRANCH_MAX = 60;
export const PROMPT_COMMENTS = 5;

/** Letters that NFKD does not decompose into ASCII plus a combining mark. */
const TRANSLITERATE: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  þ: 'th',
  ı: 'i',
};

/** Lowercase ASCII words joined by `-` (accents folded, everything else dropped). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ßæœøđðłþı]/g, (c) => TRANSLITERATE[c] ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `ENG-123` + "Fix the login flow" → `eng-123-fix-the-login-flow`: lowercase, ASCII,
 * at most 60 characters, cut at a word boundary when the title is long.
 */
export function branchName(identifier: string, title: string, max = BRANCH_MAX): string {
  const prefix = slugify(identifier) || 'issue';
  if (prefix.length >= max) return prefix.slice(0, max).replace(/-+$/, '');
  const slug = slugify(title);
  if (!slug) return prefix;
  const full = `${prefix}-${slug}`;
  if (full.length <= max) return full;
  const cut = full.slice(0, max + 1);
  const boundary = cut.lastIndexOf('-');
  // Prefer a whole word; fall back to a hard cut when the first word alone is too long.
  const trimmed = boundary > prefix.length ? cut.slice(0, boundary) : full.slice(0, max);
  return trimmed.replace(/-+$/, '');
}

export interface PromptIssue {
  identifier: string;
  title: string;
  url: string;
  descriptionMd: string;
  status: { name: string };
  priority: number;
  labels: readonly { name: string }[];
  project: { name: string } | null;
  milestone: { name: string } | null;
  children: readonly { identifier: string; title: string; status: { category: string } }[];
  relations: readonly { type: string; issue: { identifier: string; title: string } }[];
}

export interface PromptComment {
  author: string;
  createdAt: string;
  bodyMd: string;
}

export interface PromptOptions {
  /** Newest last; only the last five are used. */
  comments?: readonly PromptComment[];
  /** Free text from Settings › Coding tools, appended verbatim. */
  instructions?: string;
  /** Relative time for comment headers ("2d ago"). */
  relative: (iso: string) => string;
}

const RELATION_ORDER = ['blocks', 'blocked_by', 'related', 'duplicate', 'duplicated_by'];

function relationLabel(type: string): string {
  return (m.relationType as Record<string, string>)[type] ?? type;
}

function quote(author: string, when: string, body: string): string {
  const lines = body.trim().split(/\r?\n/);
  const [first = '', ...rest] = lines;
  return [`> **${author}** (${when}): ${first}`.trimEnd(), ...rest.map((l) => `> ${l}`.trimEnd())].join('\n');
}

/** The canonical Markdown prompt for an issue (docs/archive/ROADMAP_SOLO_AI.md U2). Empty sections are skipped. */
export function buildIssuePrompt(issue: PromptIssue, opts: PromptOptions): string {
  const t = m.prompt;
  const out: string[] = [];
  out.push(`# ${issue.identifier}: ${issue.title.trim()}`, issue.url, '');

  const meta = [`**${t.status}:** ${issue.status.name}`, `**${t.priority}:** ${m.priority[issue.priority as 0 | 1 | 2 | 3 | 4] ?? m.priority[4]}`];
  if (issue.labels.length > 0) meta.push(`**${t.labels}:** ${issue.labels.map((l) => l.name).join(', ')}`);
  if (issue.project) meta.push(`**${t.project}:** ${issue.project.name}${issue.milestone ? ` › ${issue.milestone.name}` : ''}`);
  out.push(meta.join(' · '), '');

  const description = issue.descriptionMd.trim();
  if (description) out.push(`## ${t.description}`, description, '');

  if (issue.children.length > 0) {
    out.push(`## ${t.subIssues}`);
    for (const c of issue.children) out.push(`- [${c.status.category === 'done' ? 'x' : ' '}] ${c.identifier} ${c.title}`);
    out.push('');
  }

  // Unknown relation types (forward-compatible) sort after the known ones and stay stable.
  const relationRank = (type: string) => {
    const index = RELATION_ORDER.indexOf(type);
    return index === -1 ? RELATION_ORDER.length : index;
  };
  const relations = [...issue.relations].map((r, i) => ({ r, i })).sort((a, b) => relationRank(a.r.type) - relationRank(b.r.type) || a.i - b.i).map(({ r }) => r);
  if (relations.length > 0) {
    out.push(`## ${t.related}`);
    for (const r of relations) out.push(`- ${relationLabel(r.type)} ${r.issue.identifier} ${r.issue.title}`);
    out.push('');
  }

  const comments = (opts.comments ?? []).filter((c) => c.bodyMd.trim()).slice(-PROMPT_COMMENTS);
  if (comments.length > 0) {
    out.push(`## ${t.recentComments}`);
    out.push(comments.map((c) => quote(c.author, opts.relative(c.createdAt), c.bodyMd)).join('\n>\n'));
    out.push('');
  }

  out.push(`## ${t.workingAgreement}`);
  out.push(`- ${t.branch(branchName(issue.identifier, issue.title))}`);
  out.push(`- ${t.commits(issue.identifier)}`);
  out.push(`- ${t.mcp}`);
  const instructions = opts.instructions?.trim();
  if (instructions) out.push(instructions);
  return `${out.join('\n')}\n`;
}
