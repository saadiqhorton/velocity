/**
 * Small fuzzy matcher for the command palette (SPEC §4.13). Subsequence match scored for
 * prefix, word-boundary and contiguous hits; null when the query does not match.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices into the text of every matched character, ascending. */
  indices: number[];
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct !== -1) {
    // Substring: best when at the start or at a word boundary.
    const boundary = direct === 0 || /[\s\-_/·:]/.test(t[direct - 1] ?? '');
    const indices = Array.from({ length: q.length }, (_, i) => direct + i);
    return { score: 1000 - direct + (boundary ? 200 : 0) - (t.length - q.length) * 0.5, indices };
  }
  let score = 0;
  let ti = 0;
  let streak = 0;
  const indices: number[] = [];
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    streak = found === ti ? streak + 1 : 0;
    const boundary = found === 0 || /[\s\-_/·:]/.test(t[found - 1] ?? '');
    score += 10 + streak * 5 + (boundary ? 15 : 0) - Math.min(found - ti, 10);
    indices.push(found);
    ti = found + 1;
  }
  return { score, indices };
}

export function fuzzyScore(query: string, text: string): number | null {
  return fuzzyMatch(query, text)?.score ?? null;
}

export interface FuzzyResult<T> {
  item: T;
  /** Matched character indices in the item's text (empty for an empty query). */
  indices: number[];
}

/** Ranked matches, best first, with the matched characters of each item's text. */
export function fuzzySearch<T>(items: readonly T[], query: string, text: (item: T) => string, limit = 50): FuzzyResult<T>[] {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, indices: [] }));
  return items
    .flatMap((item) => {
      const match = fuzzyMatch(query, text(item));
      return match ? [{ item, score: match.score, indices: match.indices }] : [];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, indices }) => ({ item, indices }));
}

export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string, limit = 50): T[] {
  return fuzzySearch(items, query, text, limit).map((r) => r.item);
}

/** Splits text into alternating runs of matched and unmatched characters, for highlighting. */
export function matchRuns(text: string, indices: readonly number[]): { text: string; matched: boolean }[] {
  const hit = new Set(indices);
  const runs: { text: string; matched: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const matched = hit.has(i);
    const last = runs[runs.length - 1];
    if (last && last.matched === matched) last.text += text.charAt(i);
    else runs.push({ text: text.charAt(i), matched });
  }
  return runs;
}
