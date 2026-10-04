import { dslError } from './errors';

export type TokenType = 'word' | 'string' | 'colon' | 'comma' | 'lparen' | 'rparen' | 'eof';

export interface Token {
  type: TokenType;
  /** Unescaped text for words and strings; the literal character otherwise. */
  text: string;
  /** 0-based start offset (inclusive). */
  start: number;
  /** 0-based end offset (exclusive). */
  end: number;
}

const WORD_CHAR = /^[\p{L}\p{N}_\-.@/+]$/u;
/** A word that so far looks like the start of an ISO timestamp and may continue past a colon. */
const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T[\dA-Za-z:.+-]*\d$/;
const DIGIT = /^\d$/;
const WHITESPACE = /^\s$/u;

/** True if `s` can be written as a bare (unquoted) word without ambiguity. */
export const BARE_WORD_RE = /^[\p{L}\p{N}_\-.@/]+$/u;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input.charAt(i);
    if (WHITESPACE.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', text: ch, start: i, end: i + 1 });
      i++;
    } else if (ch === ')') {
      tokens.push({ type: 'rparen', text: ch, start: i, end: i + 1 });
      i++;
    } else if (ch === ':') {
      tokens.push({ type: 'colon', text: ch, start: i, end: i + 1 });
      i++;
    } else if (ch === ',') {
      tokens.push({ type: 'comma', text: ch, start: i, end: i + 1 });
      i++;
    } else if (ch === '"') {
      const start = i;
      i++;
      let text = '';
      let closed = false;
      while (i < n) {
        const c = input.charAt(i);
        if (c === '\\') {
          const next = input.charAt(i + 1);
          if (next === '"' || next === '\\') {
            text += next;
            i += 2;
            continue;
          }
          throw dslError(input, i, `Invalid escape sequence '\\${next}' (only \\" and \\\\ are allowed)`);
        }
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        text += c;
        i++;
      }
      if (!closed) throw dslError(input, start, 'Unterminated string (missing closing \'"\')');
      tokens.push({ type: 'string', text, start, end: i });
    } else if (WORD_CHAR.test(ch)) {
      const start = i;
      while (i < n) {
        const c = input.charAt(i);
        if (WORD_CHAR.test(c)) {
          i++;
        } else if (c === ':' && DIGIT.test(input.charAt(i + 1)) && ISO_PREFIX.test(input.slice(start, i))) {
          i++;
        } else {
          break;
        }
      }
      tokens.push({ type: 'word', text: input.slice(start, i), start, end: i });
    } else {
      throw dslError(input, i, `Unexpected character '${ch}'`);
    }
  }
  tokens.push({ type: 'eof', text: '', start: n, end: n });
  return tokens;
}
