export interface ImportedReferenceTarget {
  id: string;
  identifier: string;
}

export interface ImportedReferenceEdit {
  sourceKey: string;
  destinationId: string;
  before: string;
  after: string;
  start: number;
  end: number;
}

export interface ImportedReferenceRewrite {
  text: string;
  edits: ImportedReferenceEdit[];
  unmapped: string[];
  skippedCodeReferences: number;
  alreadyCorrect: number;
}

function mark(mask: boolean[], start: number, end: number): void {
  for (let i = start; i < end; i++) mask[i] = true;
}

function markdownProtected(text: string): boolean[] {
  const mask = Array.from({ length: text.length }, () => false);
  const lines = [...text.matchAll(/.*(?:\n|$)/g)].filter((m) => m[0].length > 0);
  let fence: { char: string; size: number } | null = null;
  for (const line of lines) {
    const value = line[0];
    const offset = line.index ?? 0;
    const content = value.replace(/^(?: {0,3}>[ \t]?)+/, '');
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(content);
    if (fence) {
      mark(mask, offset, offset + value.length);
      const closing = new RegExp(`^ {0,3}${fence.char === '`' ? '`' : '~'}{${fence.size},}\\s*$`).test(content.replace(/\r?\n$/, ''));
      if (closing) fence = null;
      continue;
    }
    if (opening) {
      fence = { char: opening[1]![0]!, size: opening[1]!.length };
      mark(mask, offset, offset + value.length);
      continue;
    }
    if (/^(?: {4,}|\t)/.test(value) || /^ {0,3}\[[^\]]+\]:/.test(value)) mark(mask, offset, offset + value.length);
  }

  // Inline code spans use matching backtick-run lengths. Fenced/indented lines are already masked.
  for (let i = 0; i < text.length; ) {
    if (mask[i] || text[i] !== '`') { i++; continue; }
    let run = 1;
    while (text[i + run] === '`') run++;
    let close = i + run;
    while (close < text.length) {
      if (mask[close] || text[close] !== '`') { close++; continue; }
      let closeRun = 1;
      while (text[close + closeRun] === '`') closeRun++;
      if (closeRun === run) {
        mark(mask, i, close + closeRun);
        i = close + closeRun;
        break;
      }
      close += closeRun;
    }
    if (close >= text.length) i += run;
  }

  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>]+/g)) {
    mark(mask, m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  for (const m of text.matchAll(/\bwww\.[^\s<>]+/gi)) {
    mark(mask, m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  // Markdown link destinations: [label](destination), including balanced parentheses.
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] !== ']' || text[i + 1] !== '(' || mask[i]) continue;
    let depth = 1;
    let j = i + 2;
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === '\\') { j++; continue; }
      if (text[j] === '(') depth++;
      else if (text[j] === ')') depth--;
    }
    if (depth === 0) mark(mask, i + 2, j - 1);
  }
  return mask;
}

function isIdentifierContinuation(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_./#-]/u.test(ch);
}

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

/** Replaces only exact run-scoped keys outside Markdown code and URL/link destinations. */
export function rewriteImportedReferences(text: string, mapping: ReadonlyMap<string, ImportedReferenceTarget | null>): ImportedReferenceRewrite {
  const mask = markdownProtected(text);
  const keys = [...mapping.keys()].filter(Boolean).sort((a, b) => b.length - a.length || a.localeCompare(b));
  const root: { next: Map<string, typeof root>; keys: string[] } = { next: new Map(), keys: [] };
  for (const key of keys) {
    let node = root;
    for (const ch of key) {
      let child = node.next.get(ch);
      if (!child) { child = { next: new Map(), keys: [] }; node.next.set(ch, child); }
      node = child;
    }
    node.keys.push(key);
  }
  const edits: ImportedReferenceEdit[] = [];
  const unmapped = new Set<string>();
  let alreadyCorrect = 0;
  let skippedCodeReferences = 0;
  let rebuilt = '';
  let cursor = 0;
  for (let i = 0; i < text.length; ) {
    let node = root;
    let end = i;
    let key: string | undefined;
    while (end < text.length) {
      const child = node.next.get(text[end]!);
      if (!child) break;
      node = child;
      end++;
      const candidate = node.keys.find(() => !isIdentifierContinuation(text[i - 1]) && !isWord(text[end]));
      if (candidate) key = candidate;
    }
    if (!key) { i++; continue; }
    const matchEnd = i + key.length;
    const protectedCount = mask.slice(i, matchEnd).some(Boolean);
    if (protectedCount) {
      skippedCodeReferences++;
      i = matchEnd;
      continue;
    }
    const target = mapping.get(key);
    if (!target) {
      unmapped.add(key);
      i = matchEnd;
      continue;
    }
    if (target.identifier === key) {
      alreadyCorrect++;
      i = matchEnd;
      continue;
    }
    rebuilt += text.slice(cursor, i) + target.identifier;
    edits.push({ sourceKey: key, destinationId: target.id, before: key, after: target.identifier, start: i, end: matchEnd });
    cursor = matchEnd;
    i = matchEnd;
  }
  if (edits.length) rebuilt += text.slice(cursor);
  else rebuilt = text;
  // Report recognizable references outside this run without guessing a destination for them.
  const unknownPatterns = [/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d{1,15}/g, /[A-Za-z][A-Za-z0-9]{0,9}-\d{1,15}/g];
  for (const pattern of unknownPatterns) {
    for (const m of text.matchAll(pattern)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (isIdentifierContinuation(text[start - 1]) || isWord(text[end]) || mapping.has(m[0])) continue;
      if (mask.slice(start, end).some(Boolean)) { skippedCodeReferences++; continue; }
      unmapped.add(m[0]);
    }
  }
  return { text: rebuilt, edits, unmapped: [...unmapped].sort((a, b) => text.indexOf(a) - text.indexOf(b)), skippedCodeReferences, alreadyCorrect };
}

/** Returns only exact keys from a persisted run map that occur in unprotected Markdown. */
export function findImportedReferenceKeys(text: string, keys: Iterable<string>): string[] {
  const mapping = new Map([...keys].map((key) => [key, null] as const));
  const known = new Set(mapping.keys());
  return rewriteImportedReferences(text, mapping).unmapped.filter((key) => known.has(key));
}
