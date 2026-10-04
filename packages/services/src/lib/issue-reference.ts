/**
 * Issue reference parsing (SPEC §6.8).
 *
 * Close intent: one of fix/fixes/fixed/close/closes/closed/resolve/resolves/resolved
 * (case-insensitive), optionally followed by `:`, then whitespace, IMMEDIATELY before the
 * reference. The keyword applies to a single reference only: in
 * `Fixes ENG-1, ENG-2` only ENG-1 closes; write `Fixes ENG-1, fixes ENG-2` to close both.
 * Duplicate identifiers are merged; `closes` is true if any occurrence closes.
 */

export type IssueReference =
  | { kind: 'identifier'; identifier: string; teamKey: string; number: number; closes: boolean; index: number }
  | { kind: 'url'; issueId: string; index: number };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CLOSE_RE = /(?:^|[^A-Za-z0-9])(?:fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)(?::[ \t\r\n]*|[ \t\r\n]+:?[ \t\r\n]*)$/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function identifierRefs(text: string, teamKeys: string[], detectClose: boolean): IssueReference[] {
  const canonical = new Map<string, string>();
  for (const k of teamKeys) canonical.set(k.toUpperCase(), k.toUpperCase());
  if (canonical.size === 0) return [];
  const alt = [...canonical.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  const re = new RegExp(`(?<![A-Za-z0-9])(${alt})-(\\d{1,15})(?![A-Za-z0-9])`, 'gi');
  const out: IssueReference[] = [];
  for (const m of text.matchAll(re)) {
    const key = canonical.get((m[1] as string).toUpperCase());
    const number = Number(m[2]);
    if (!key || !Number.isSafeInteger(number) || number < 1) continue;
    const index = m.index ?? 0;
    const closes = detectClose && CLOSE_RE.test(text.slice(Math.max(0, index - 24), index));
    out.push({ kind: 'identifier', identifier: `${key}-${number}`, teamKey: key, number, closes, index });
  }
  return out;
}

export function findIssueReferences(text: string, teamKeys: string[], opts: { appUrl?: string } = {}): IssueReference[] {
  const refs: IssueReference[] = identifierRefs(text, teamKeys, true);
  let host: string | null = null;
  if (opts.appUrl) {
    try {
      host = new URL(opts.appUrl).host.toLowerCase();
    } catch {
      host = null;
    }
  }
  const urlRe = new RegExp(`https?://([^\\s/<>()\\[\\]"']+)/issue/(${UUID})(?![0-9a-zA-Z-])`, 'gi');
  for (const m of text.matchAll(urlRe)) {
    if (host !== null && (m[1] as string).toLowerCase() !== host) continue;
    refs.push({ kind: 'url', issueId: (m[2] as string).toLowerCase(), index: m.index ?? 0 });
  }
  refs.sort((a, b) => a.index - b.index);
  const seen = new Map<string, IssueReference>();
  const result: IssueReference[] = [];
  for (const r of refs) {
    const key = r.kind === 'identifier' ? r.identifier : `url:${r.issueId}`;
    const prev = seen.get(key);
    if (prev) {
      if (prev.kind === 'identifier' && r.kind === 'identifier' && r.closes) prev.closes = true;
      continue;
    }
    seen.set(key, r);
    result.push(r);
  }
  return result;
}

/** Identifier references found in a git branch name (`eng-123-fix-login`, `feature/ENG-123`); never close-intent. */
export function extractIssueRefsFromBranch(branch: string, teamKeys: string[]): IssueReference[] {
  const seen = new Set<string>();
  const out: IssueReference[] = [];
  for (const r of identifierRefs(branch, teamKeys, false)) {
    if (r.kind === 'identifier' && !seen.has(r.identifier)) {
      seen.add(r.identifier);
      out.push(r);
    }
  }
  return out;
}
