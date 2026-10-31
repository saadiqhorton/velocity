export interface ImportedReferenceTarget {
  id: string;
  identifier: string;
}

export interface ImportedReferenceEdit {
  sourceKey: string;
  destinationId: string;
  identifier: string;
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

interface InlineMarkdownLink {
  start: number;
  end: number;
  labelStart: number;
  labelEnd: number;
  destination: string;
  image: boolean;
}

function mark(mask: boolean[], start: number, end: number): void {
  for (let i = start; i < end; i++) mask[i] = true;
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function markdownProtected(text: string): boolean[] {
  const mask = Array.from({ length: text.length }, () => false);
  const lines = [...text.matchAll(/.*(?:\n|$)/g)].filter((m) => m[0].length > 0);
  const referenceLabels = new Set<string>();
  let fence: { char: string; size: number } | null = null;
  for (const line of lines) {
    const value = line[0];
    const offset = line.index ?? 0;
    const content = value.replace(/^(?: {0,3}>[ \t]?)+/, '');
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(content);
    if (fence) {
      mark(mask, offset, offset + value.length);
      const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(content.replace(/\r?\n$/, ''));
      const closingRun = closing?.[1] ?? '';
      if (closingRun[0] === fence.char && closingRun.length >= fence.size) fence = null;
      continue;
    }
    if (opening) {
      fence = { char: opening[1]![0]!, size: opening[1]!.length };
      mark(mask, offset, offset + value.length);
      continue;
    }
    if (/^(?: {4,}|\t)/.test(content)) mark(mask, offset, offset + value.length);
    else {
      const definition = /^ {0,3}\[([^\]]+)\]:/.exec(content);
      if (definition) {
        referenceLabels.add(definition[1]!.trim().replace(/\s+/g, ' ').toLowerCase());
        mark(mask, offset, offset + value.length);
      }
    }
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

  // Reference-style links retain their definition and destination as one Markdown unit.
  for (const match of text.matchAll(/!?\[([^\]\n]*)\](?:\[([^\]\n]*)\])?/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const label = (match[2] || match[1] || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const shortcut = match[2] === undefined && text[end] !== '(';
    if ((match[2] === undefined && !shortcut) || (!referenceLabels.has(label) && match[2] === undefined)) continue;
    if (!mask.slice(start, end).some(Boolean)) mark(mask, start, end);
  }

  return mask;
}

/** Protects every bare URL range, even when a Markdown construct masks part of it. */
function markProtectedUrls(text: string, mapping: ReadonlyMap<string, unknown>, mask: boolean[]): void {
  for (const m of text.matchAll(/\b([A-Za-z][A-Za-z0-9+.-]*):[^\s<>]+/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const scheme = m[1]!;
    const colon = start + scheme.length;
    if (mapping.has(scheme) && text[colon + 1] !== '/') continue;
    mark(mask, start, end);
  }
  for (const m of text.matchAll(/(^|[\s(])\/\/[^\s<>]+/gm)) {
    const prefixLength = m[1]!.length;
    const start = (m.index ?? 0) + prefixLength;
    const end = start + m[0].length - prefixLength;
    mark(mask, start, end);
  }
  for (const m of text.matchAll(/\bwww\.[^\s<>]+/gi)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    mark(mask, start, end);
  }
}

/** Parses the destination and optional title of `[label](...)`, returning the full closing position. */
function parseInlineDestination(text: string, destinationStart: number): { destination: string; end: number } | null {
  let i = destinationStart;
  while (text[i] === ' ' || text[i] === '\t') i++;
  let destination: string;
  if (text[i] === '<') {
    const start = ++i;
    while (i < text.length && (text[i] !== '>' || isEscaped(text, i))) i++;
    if (i >= text.length) return null;
    destination = text.slice(start, i);
    i++;
  } else {
    const start = i;
    let depth = 0;
    while (i < text.length) {
      const ch = text[i]!;
      if (isEscaped(text, i)) { i++; continue; }
      if (ch === '(') { depth++; i++; continue; }
      if (ch === ')') {
        if (depth === 0) break;
        depth--;
        i++;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') break;
      i++;
    }
    destination = text.slice(start, i);
  }
  if (!destination) return null;

  while (text[i] === ' ' || text[i] === '\t' || text[i] === '\r' || text[i] === '\n') i++;
  if (text[i] === ')') return { destination, end: i + 1 };

  const quote = text[i];
  if (quote !== '"' && quote !== "'" && quote !== '(') return null;
  const titleEnd = quote === '(' ? ')' : quote;
  i++;
  while (i < text.length && (text[i] !== titleEnd || isEscaped(text, i))) i++;
  if (i >= text.length) return null;
  i++;
  while (text[i] === ' ' || text[i] === '\t' || text[i] === '\r' || text[i] === '\n') i++;
  return text[i] === ')' ? { destination, end: i + 1 } : null;
}

function inlineMarkdownLinks(text: string, mask: boolean[]): InlineMarkdownLink[] {
  const links: InlineMarkdownLink[] = [];
  for (let close = 1; close < text.length - 1; close++) {
    if (mask[close] || text[close] !== ']' || text[close + 1] !== '(' || isEscaped(text, close)) continue;
    let depth = 0;
    let open = -1;
    for (let i = close - 1; i >= 0; i--) {
      if (isEscaped(text, i)) continue;
      if (text[i] === ']') { depth++; continue; }
      if (text[i] !== '[') continue;
      if (depth === 0) { open = i; break; }
      depth--;
    }
    if (open < 0 || mask[open]) continue;
    const parsed = parseInlineDestination(text, close + 2);
    if (!parsed || mask[open] || mask[close]) continue;
    const image = open > 0 && text[open - 1] === '!' && !isEscaped(text, open - 1);
    links.push({
      start: image ? open - 1 : open,
      end: parsed.end,
      labelStart: open + 1,
      labelEnd: close,
      destination: parsed.destination,
      image,
    });
    close = parsed.end - 1;
  }
  return links;
}

function linearIssueKey(destination: string): string | null {
  // WHATWG removes an explicit default :443 port, so compare the raw authority first.
  const authority = /^https?:\/\/([^/?#]*)/i.exec(destination)?.[1];
  if (authority?.toLowerCase() !== 'linear.app') return null;
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'linear.app' || url.port || url.username || url.password) return null;
  const segments = url.pathname.split('/');
  if (segments.length < 4 || segments.length > 5 || segments[0] !== '' || !segments[1] || segments[2] !== 'issue' || !segments[3]) return null;
  try {
    return decodeURIComponent(segments[3]);
  } catch {
    return null;
  }
}

/** Returns the destination UUID for an exact local `/issue/<uuid>` link. */
function canonicalIssueId(destination: string): string | null {
  if (!destination.startsWith('/issue/')) return null;
  const value = destination.slice('/issue/'.length);
  if (!value || value.includes('/') || /[?#]/.test(value)) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isIdentifierContinuation(ch: string | undefined, next: string | undefined): boolean {
  if (ch === undefined) return false;
  if (ch === '.') return next !== undefined && /[\p{L}\p{N}_/#-]/u.test(next);
  return /[\p{L}\p{N}_/#-]/u.test(ch);
}

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

/**
 * Replaces exact run-scoped references and mapped Linear links outside Markdown code and protected URLs.
 * Callers must pass only mappings persisted for the import run being rewritten.
 * This function never consults workspace-level issue data.
 */
export function rewriteImportedReferences(text: string, mapping: ReadonlyMap<string, ImportedReferenceTarget | null>): ImportedReferenceRewrite {
  const codeMask = markdownProtected(text);
  const protectedMask = [...codeMask];
  markProtectedUrls(text, mapping, protectedMask);
  const links = inlineMarkdownLinks(text, codeMask).filter((link) => !protectedMask[link.start]);
  const linkMask = [...protectedMask];
  const linkEnds = new Map<number, number>();
  for (const link of links) {
    mark(linkMask, link.start, link.end);
    linkEnds.set(link.start, link.end);
  }

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

  const targetsById = new Map<string, ImportedReferenceTarget>();
  for (const target of mapping.values()) if (target) targetsById.set(target.id, target);

  const linkEdits = new Map<number, ImportedReferenceEdit>();
  const edits: ImportedReferenceEdit[] = [];
  const unmapped = new Set<string>();
  let alreadyCorrect = 0;
  let skippedCodeReferences = 0;

  for (const link of links) {
    if (link.image) continue;
    const localId = canonicalIssueId(link.destination);
    if (localId !== null) {
      const target = targetsById.get(localId);
      if (target && text.slice(link.labelStart, link.labelEnd) === target.identifier) alreadyCorrect++;
      continue;
    }
    const sourceKey = linearIssueKey(link.destination);
    if (sourceKey === null) continue;
    const target = mapping.get(sourceKey);
    if (!target) {
      unmapped.add(sourceKey);
      continue;
    }
    const after = `[${target.identifier}](/issue/${encodeURIComponent(target.id)})`;
    linkEdits.set(link.start, {
      sourceKey,
      destinationId: target.id,
      identifier: target.identifier,
      before: text.slice(link.start, link.end),
      after,
      start: link.start,
      end: link.end,
    });
  }

  let rebuilt = '';
  let cursor = 0;
  for (let i = 0; i < text.length; ) {
    const linkEnd = linkEnds.get(i);
    if (linkEnd !== undefined) {
      const edit = linkEdits.get(i);
      if (edit) {
        rebuilt += text.slice(cursor, i) + edit.after;
        edits.push(edit);
        cursor = linkEnd;
      }
      i = linkEnd;
      continue;
    }
    if (linkMask[i] && !codeMask[i]) {
      i++;
      continue;
    }

    let node = root;
    let end = i;
    let key: string | undefined;
    while (end < text.length) {
      const child = node.next.get(text[end]!);
      if (!child) break;
      node = child;
      end++;
      const candidate = node.keys.find(() => !isIdentifierContinuation(text[i - 1], text[i]) && !isIdentifierContinuation(text[end], text[end + 1]) && !isWord(text[end]));
      if (candidate) key = candidate;
    }
    if (!key) { i++; continue; }
    const matchEnd = i + key.length;
    if (codeMask.slice(i, matchEnd).some(Boolean)) {
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
    edits.push({ sourceKey: key, destinationId: target.id, identifier: target.identifier, before: key, after: target.identifier, start: i, end: matchEnd });
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
      if (isIdentifierContinuation(text[start - 1], text[start]) || isIdentifierContinuation(text[end], text[end + 1]) || isWord(text[end]) || mapping.has(m[0])) continue;
      if (codeMask.slice(start, end).some(Boolean)) { skippedCodeReferences++; continue; }
      if (linkMask.slice(start, end).some(Boolean)) continue;
      unmapped.add(m[0]);
    }
  }
  return { text: rebuilt, edits, unmapped: [...unmapped].sort((a, b) => text.indexOf(a) - text.indexOf(b)), skippedCodeReferences, alreadyCorrect };
}

/** Returns only exact keys from a persisted run map that occur in unprotected Markdown or Linear inline links. */
export function findImportedReferenceKeys(text: string, keys: Iterable<string>): string[] {
  const mapping = new Map([...keys].map((key) => [key, null] as const));
  const known = new Set(mapping.keys());
  return rewriteImportedReferences(text, mapping).unmapped.filter((key) => known.has(key));
}
