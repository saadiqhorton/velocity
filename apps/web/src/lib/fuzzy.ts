/**
 * Small fuzzy matcher for the command palette (SPEC §4.13). Subsequence match scored for
 * prefix, word-boundary and contiguous hits; null when the query does not match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct !== -1) {
    // Substring: best when at the start or at a word boundary.
    const boundary = direct === 0 || /[\s\-_/·:]/.test(t[direct - 1] ?? '');
    return 1000 - direct + (boundary ? 200 : 0) - (t.length - q.length) * 0.5;
  }
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    streak = found === ti ? streak + 1 : 0;
    const boundary = found === 0 || /[\s\-_/·:]/.test(t[found - 1] ?? '');
    score += 10 + streak * 5 + (boundary ? 15 : 0) - Math.min(found - ti, 10);
    ti = found + 1;
  }
  return score;
}

export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string, limit = 50): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}
