/**
 * Server-side markdown sanitising (SPEC §7.1.4).
 *
 * Approach: tokenise with marked's lexer (no HTML is ever rendered here), then apply minimal
 * text edits to the ORIGINAL source at each offending token's location: raw HTML tokens (block and
 * inline, never inside code) keep their text but every `<` is backslash-escaped (`\<`) so it renders literally, and link/image/definition destinations whose scheme is not
 * http/https/mailto (after entity decoding and control/whitespace stripping) are rewritten to `#`.
 * Everything else is preserved byte-for-byte. CRLF/CR line endings are normalised to LF (as marked does).
 * A verification pass re-lexes the result; if anything unsafe somehow remains, a conservative
 * fallback escapes `<` and neutralises destinations.
 */
import { Lexer, type Token, type Tokens } from 'marked';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', colon: ':', tab: '\t', newline: '\n',
  sol: '/', lpar: '(', rpar: ')', semi: ';', comma: ',', period: '.', num: '#', excl: '!', lsqb: '[', rsqb: ']',
  lbrack: '[', rbrack: ']', lcub: '{', rcub: '}', percnt: '%', plus: '+', equals: '=', quest: '?', commat: '@',
  bsol: '\\', grave: '`', lowbar: '_', hyphen: '-', dash: '-', hyphen_: '-',
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:#[xX]([0-9a-fA-F]{1,8})|#(\d{1,10})|([a-zA-Z][a-zA-Z0-9]{1,31}));?/g, (m, hex?: string, dec?: string, name?: string) => {
    if (hex !== undefined || dec !== undefined) {
      const cp = hex !== undefined ? parseInt(hex, 16) : parseInt(dec as string, 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '\ufffd';
    }
    const v = NAMED_ENTITIES[(name as string).toLowerCase()];
    return v !== undefined && m.endsWith(';') ? v : m;
  });
}

// eslint-disable-next-line no-control-regex
const STRIP_RE = /[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u2060\ufeff]/g;

/** True when the destination is safe: relative, or http/https/mailto. */
export function isSafeUrl(href: string): boolean {
  let s = href;
  for (let i = 0; i < 3; i++) {
    const d = decodeEntities(s);
    if (d === s) break;
    s = d;
  }
  try {
    s = decodeURIComponent(s.replace(/%(?![0-9a-fA-F]{2})/g, '%25'));
  } catch {
    /* keep s */
  }
  s = s.replace(/\\/g, '/').replace(STRIP_RE, '').toLowerCase();
  const colon = s.search(/[:]/);
  if (colon < 0) return !/^&[a-z0-9#]+;/.test(s);
  const before = s.slice(0, colon);
  if (/[/?#]/.test(before)) return true; // colon lives in path/query/fragment
  return before === 'http' || before === 'https' || before === 'mailto';
}

/** Tag-like text marked did not tokenise as html (e.g. `<svg/onload=x>`, or a `<` that merely starts a tag-like run); escaped as defence in depth. */
const TAGLIKE_RE = /<(?=[A-Za-z/!?])/g;

type Edit = { start: number; end: number; text: string };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function locate(src: string, raw: string, from: number): { start: number; end: number } | null {
  const idx = src.indexOf(raw, from);
  if (idx >= 0) return { start: idx, end: idx + raw.length };
  const trimmed = raw.replace(/\n+$/, '');
  if (trimmed === '') return null;
  const lines = trimmed.split('\n').map((l) => escapeRe(l.replace(/^[ \t]+/, '')));
  const re = new RegExp(lines.join('\\n[ \\t>]*'), 'g');
  re.lastIndex = from;
  const m = re.exec(src);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/**
 * Backslash-escape every `<` (CommonMark `\<`) so the text renders literally. Backslash runs directly
 * before a `<` are doubled so an existing `\` stays a literal backslash instead of escaping our escape.
 */
function escapeLt(raw: string): string {
  return raw.replace(/(\\*)</g, (_m, b: string) => b + b + '\\<');
}

function trailingWs(raw: string): string {
  return /\s*$/.exec(raw)?.[0] ?? '';
}

function cleanLabel(s: string): string {
  return s.replace(/[<>[\]\\`]/g, '');
}

function collect(src: string, tokens: Token[], from: number, edits: Edit[], misses: { count: number }): void {
  let cursor = from;
  for (const tok of tokens) {
    const raw = (tok as { raw?: string }).raw ?? '';
    if (raw === '') continue;
    const loc = locate(src, raw, cursor);
    if (!loc) {
      if (tok.type === 'html' || tok.type === 'link' || tok.type === 'image' || tok.type === 'def') misses.count++;
      // still try to examine children from the current cursor
      visitChildren(src, tok, cursor, edits, misses);
      continue;
    }
    const { start, end } = loc;
    switch (tok.type) {
      case 'html':
        edits.push({ start, end, text: escapeLt(raw) });
        break;
      case 'link': {
        const t = tok as Tokens.Link;
        if (isSafeUrl(t.href)) {
          visitChildren(src, tok, start, edits, misses);
        } else {
          const label = t.tokens.map((c) => c.raw).join('');
          if (raw.startsWith('[' + label + '](')) {
            visitChildren(src, tok, start, edits, misses);
            edits.push({ start: start + 1 + label.length, end, text: '](#)' });
          } else {
            edits.push({ start, end, text: `[${cleanLabel(t.text)}](#)` });
          }
        }
        break;
      }
      case 'image': {
        const t = tok as Tokens.Image;
        if (!isSafeUrl(t.href)) {
          const m = /^!\[[^\]]*\]\(/.exec(raw);
          if (m && raw.endsWith(')')) edits.push({ start: start + m[0].length - 2, end, text: '](#)' });
          else edits.push({ start, end, text: `![${cleanLabel(t.text)}](#)` });
        }
        break;
      }
      case 'text': {
        if (!(tok as Tokens.Text).tokens) {
          for (const m of raw.matchAll(TAGLIKE_RE)) edits.push({ start: start + (m.index ?? 0), end: start + (m.index ?? 0) + m[0].length, text: escapeLt(m[0]) });
        } else visitChildren(src, tok, start, edits, misses);
        break;
      }
      case 'def': {
        const t = tok as Tokens.Def;
        if (!isSafeUrl(t.href)) edits.push({ start, end, text: `[${cleanLabel(t.tag)}]: #${trailingWs(raw)}` });
        break;
      }
      default:
        visitChildren(src, tok, start, edits, misses);
    }
    cursor = end;
  }
}

function visitChildren(src: string, tok: Token, from: number, edits: Edit[], misses: { count: number }): void {
  const t = tok as Token & { tokens?: Token[]; items?: Token[]; header?: Tokens.TableCell[]; rows?: Tokens.TableCell[][] };
  if (t.type === 'codespan' || t.type === 'code') return;
  if (Array.isArray(t.items)) collect(src, t.items, from, edits, misses);
  else if (t.type === 'table') {
    for (const c of t.header ?? []) collect(src, c.tokens, from, edits, misses);
    for (const r of t.rows ?? []) for (const c of r) collect(src, c.tokens, from, edits, misses);
  } else if (Array.isArray(t.tokens)) collect(src, t.tokens, from, edits, misses);
}

function applyEdits(src: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const e of sorted) {
    if (e.start < pos) continue; // overlapping (nested) edit already covered
    out += src.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + src.slice(pos);
}

function lex(md: string): Token[] {
  return new Lexer({ gfm: true }).lex(md);
}

function hasUnsafe(tokens: Token[]): boolean {
  for (const tok of tokens) {
    const t = tok as Token & { tokens?: Token[]; items?: Token[]; header?: Tokens.TableCell[]; rows?: Tokens.TableCell[][]; href?: string };
    if (t.type === 'html') return true;
    if (t.type === 'text' && !t.tokens && new RegExp(TAGLIKE_RE.source).test((t as Tokens.Text).raw)) return true;
    if ((t.type === 'link' || t.type === 'image' || t.type === 'def') && !isSafeUrl(t.href ?? '')) return true;
    if (t.type === 'code' || t.type === 'codespan') continue;
    if (Array.isArray(t.items) && hasUnsafe(t.items)) return true;
    if (Array.isArray(t.tokens) && hasUnsafe(t.tokens)) return true;
    if (t.type === 'table') {
      for (const c of t.header ?? []) if (hasUnsafe(c.tokens)) return true;
      for (const r of t.rows ?? []) for (const c of r) if (hasUnsafe(c.tokens)) return true;
    }
  }
  return false;
}

function fallback(md: string): string {
  return md
    .replace(/<(?=[A-Za-z/!?])/g, '&lt;')
    .replace(/\]\(\s*<?([^)\s>]*)[^)]*\)/g, (m, dest: string) => (isSafeUrl(dest) ? m : '](#)'))
    .replace(/^(\s{0,3}\[[^\]]+\]:\s*)(\S+)/gm, (m, pre: string, dest: string) => (isSafeUrl(dest) ? m : `${pre}#`));
}

/** Escape raw HTML (`<` -> `\<`) and rewrite unsafe URL schemes; otherwise return the markdown unchanged. Idempotent. */
export function sanitizeMarkdown(md: string): string {
  const src = md.replace(/\r\n?/g, '\n');
  let out = src;
  for (let pass = 0; pass < 6; pass++) {
    const tokens = lex(out);
    if (!hasUnsafe(tokens)) return out;
    const edits: Edit[] = [];
    collect(out, tokens, 0, edits, { count: 0 });
    const next = applyEdits(out, edits);
    if (next === out) break;
    out = next;
  }
  const tokens = lex(out);
  return hasUnsafe(tokens) ? fallback(out) : out;
}

function leafTexts(tokens: Token[], out: string[]): void {
  for (const tok of tokens) {
    const t = tok as Token & { tokens?: Token[]; items?: Token[]; header?: Tokens.TableCell[]; rows?: Tokens.TableCell[][]; text?: string; raw: string };
    switch (t.type) {
      case 'code':
      case 'codespan':
      case 'html':
      case 'escape':
      case 'def':
      case 'image':
        out.push('\u0000'); // boundary so adjacent text cannot merge into a mention
        continue;
      case 'link': {
        const lk = t as Tokens.Link;
        if (t.raw.startsWith('<') || lk.text === lk.href || lk.href.startsWith('http://' + lk.text)) {
          out.push('\u0000');
          continue;
        }
        leafTexts(lk.tokens, out);
        out.push('\u0000');
        continue;
      }
      case 'table':
        for (const c of t.header ?? []) leafTexts(c.tokens, out);
        for (const r of t.rows ?? []) for (const c of r) leafTexts(c.tokens, out);
        continue;
    }
    if (Array.isArray(t.items)) leafTexts(t.items, out);
    else if (Array.isArray(t.tokens)) leafTexts(t.tokens, out);
    else if (t.type === 'text') out.push(t.raw);
    else out.push('\u0000');
  }
}

/** `@username` mentions (`[a-z0-9_.-]{2,32}`), outside code and emails; lowercased, deduped, in order. Trailing `.`/`-` is treated as punctuation. */
export function extractMentions(md: string): string[] {
  const parts: string[] = [];
  leafTexts(lex(md.replace(/\r\n?/g, '\n')), parts);
  const seen = new Set<string>();
  const re = /(?<![A-Za-z0-9_.%+\-@])@([A-Za-z0-9_.-]+)/g;
  for (const part of parts) {
    for (const m of part.matchAll(re)) {
      const name = (m[1] as string).replace(/[.-]+$/, '').toLowerCase();
      const after = part[(m.index ?? 0) + m[0].length];
      if (after === '@') continue;
      if (name.length >= 2 && name.length <= 32 && /^[a-z0-9_.-]+$/.test(name)) seen.add(name);
    }
  }
  return [...seen];
}

function plain(tokens: Token[]): string {
  let out = '';
  for (const tok of tokens) {
    const t = tok as Token & { tokens?: Token[]; items?: Token[]; header?: Tokens.TableCell[]; rows?: Tokens.TableCell[][]; text?: string };
    switch (t.type) {
      case 'html':
      case 'hr':
      case 'def':
      case 'space':
        out += t.type === 'space' ? '' : ' ';
        break;
      case 'br':
        out += ' ';
        break;
      case 'image':
        out += (t as Tokens.Image).text;
        break;
      case 'code':
      case 'codespan':
        out += ' ' + (t.text ?? '') + ' ';
        break;
      case 'escape':
        out += t.text ?? '';
        break;
      case 'table':
        for (const c of t.header ?? []) out += ' ' + plain(c.tokens) + ' ';
        for (const r of t.rows ?? []) for (const c of r) out += ' ' + plain(c.tokens) + ' ';
        break;
      default:
        if (Array.isArray(t.items)) out += plain(t.items) + ' ';
        else if (Array.isArray(t.tokens)) out += plain(t.tokens) + (t.type === 'text' || t.type === 'strong' || t.type === 'em' || t.type === 'del' || t.type === 'link' ? '' : ' ');
        else out += t.text ?? '';
    }
  }
  return out;
}

/** Plain-text preview: markup, HTML and URLs-in-links dropped, whitespace collapsed, truncated with an ellipsis. */
export function markdownToPlainText(md: string, maxLen?: number): string {
  const text = decodeEntities(plain(lex(md.replace(/\r\n?/g, '\n'))))
    .replace(/\s+/g, ' ')
    .trim();
  if (maxLen === undefined || text.length <= maxLen) return text;
  if (maxLen <= 0) return '';
  if (maxLen === 1) return '\u2026';
  return text.slice(0, maxLen - 1).trimEnd() + '\u2026';
}
