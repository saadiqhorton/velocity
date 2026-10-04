/** Small helpers to merge convenience params into a filter DSL string. Parsing stays on the server. */

export function quoteDslValue(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Split a trailing top-level `order:` clause from the filter expression. */
export function splitOrder(dsl: string): { filter: string; order: string } {
  const m = /(^|\s)order:/i.exec(dsl);
  if (!m) return { filter: dsl.trim(), order: '' };
  const idx = m.index + (m[1]?.length ?? 0);
  return { filter: dsl.slice(0, idx).trim(), order: dsl.slice(idx).trim() };
}

/** AND extra clauses onto a DSL string, keeping any order clause last. */
export function mergeDsl(dsl: string | undefined, extras: string[]): string | undefined {
  const { filter, order } = splitOrder(dsl ?? '');
  const parts: string[] = [];
  if (filter) parts.push(extras.length > 0 ? `(${filter})` : filter);
  parts.push(...extras);
  const out = [parts.join(' and '), order].filter(Boolean).join(' ');
  return out === '' ? undefined : out;
}
