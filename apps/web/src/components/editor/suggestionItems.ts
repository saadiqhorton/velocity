/**
 * Pure helpers for the editor's `/`, `@` and `#` suggestions (SPEC §4.12 text-field rules).
 * No DOM or TipTap imports: this module is covered by unit tests on its own.
 */

export type SlashCommandId =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'blockquote'
  | 'codeBlock'
  | 'divider';

export interface SlashCommand {
  id: SlashCommandId;
  /** Extra English search terms, matched alongside the localized title. */
  keywords: readonly string[];
}

/** Slash menu entries, in menu order. Titles come from the message catalog (`m.editor.slash`). */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: 'heading1', keywords: ['h1', 'title', 'heading', 'header'] },
  { id: 'heading2', keywords: ['h2', 'subtitle', 'heading', 'header'] },
  { id: 'heading3', keywords: ['h3', 'heading', 'header'] },
  { id: 'bulletList', keywords: ['bullet', 'unordered', 'ul', 'list'] },
  { id: 'orderedList', keywords: ['ordered', 'numbered', 'ol', 'list'] },
  { id: 'taskList', keywords: ['task', 'todo', 'checkbox', 'check', 'checklist'] },
  { id: 'blockquote', keywords: ['quote', 'citation', 'blockquote'] },
  { id: 'codeBlock', keywords: ['code', 'pre', 'snippet', 'fence'] },
  { id: 'divider', keywords: ['hr', 'rule', 'horizontal', 'line', 'separator'] },
];

/** 0 = no match. Exact > prefix > word-start > substring. */
function matchScore(query: string, fields: readonly string[]): number {
  let best = 0;
  for (const raw of fields) {
    const field = raw.toLowerCase();
    if (field === query) return 4;
    if (field.startsWith(query)) best = Math.max(best, 3);
    else if (field.split(/[\s\-_/.]+/).some((word) => word.startsWith(query))) best = Math.max(best, 2);
    else if (field.includes(query)) best = Math.max(best, 1);
  }
  return best;
}

/**
 * Filters and ranks `items` by their search fields. An empty query keeps the original order.
 * Ties keep the original order, so menus stay predictable while the user types.
 */
export function rankItems<T>(items: readonly T[], query: string, fields: (item: T) => readonly string[], limit = Infinity): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  return items
    .map((item, index) => ({ item, index, score: matchScore(q, fields(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function filterSlashCommands(query: string, title: (id: SlashCommandId) => string): SlashCommand[] {
  return rankItems(SLASH_COMMANDS, query, (c) => [title(c.id), ...c.keywords]);
}

export interface MentionCandidate {
  username: string;
  name: string;
}

/** `@` member menu: matches the username (what the server parses) and the display name. */
export function rankMembers<T extends MentionCandidate>(members: readonly T[], query: string, limit = 8): T[] {
  return rankItems(members, query, (member) => [member.username, member.name], limit);
}

/**
 * Normalizes a link typed in the selection toolbar. Returns null for schemes other than
 * http(s)/mailto (javascript: and friends never reach the document).
 */
export function normalizeLinkHref(input: string): string | null {
  const href = input.trim();
  if (!href) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (scheme) {
    const name = (scheme[1] ?? '').toLowerCase();
    return name === 'http' || name === 'https' || name === 'mailto' ? href : null;
  }
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return href;
  return `https://${href}`;
}

/**
 * The markdown serializer backslash-escapes `_` in plain text, which turns `@john_doe` into `@john\_doe`.
 * The server's mention parser (services/lib/markdown.ts) then reads `john`, so `@`-tokens are written back
 * unescaped. Usernames allow `_`, `.` and `-`; other escapes are left alone.
 */
export function unescapeMentionMarkdown(markdown: string): string {
  return markdown.replace(/(?<![A-Za-z0-9_.%+\-@])@[A-Za-z0-9_.\-\\]+/g, (token) => (token.includes('\\_') ? token.replace(/\\_/g, '_') : token));
}

/** In-app path of an issue (the route is keyed by the issue UUID, see router.tsx). */
export function issueHref(issueId: string): string {
  return `/issue/${issueId}`;
}
