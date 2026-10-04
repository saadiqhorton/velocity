import { TEAM_KEY_RE } from '@velocity/schema';

const IDENT_RE = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d{1,15})$/;

/** `eng-12` -> `{ teamKey: 'ENG', number: 12 }`; null when malformed or number < 1. */
export function parseIdentifier(s: string): { teamKey: string; number: number } | null {
  const m = IDENT_RE.exec(s.trim());
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return { teamKey: (m[1] as string).toUpperCase(), number: n };
}

export function formatIdentifier(teamKey: string, n: number): string {
  return `${teamKey.toUpperCase()}-${n}`;
}

export function isValidTeamKey(k: string): boolean {
  return TEAM_KEY_RE.test(k);
}

function asciiAlnum(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '');
}

/**
 * Suggest an unused team key from a team name: initials for multi-word names,
 * else the first letters; widens, then falls back to numeric suffixes.
 */
export function suggestTeamKey(name: string, taken: Set<string>): string {
  const isFree = (k: string) => isValidTeamKey(k) && !taken.has(k);
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const candidates: string[] = [];
  const joined = asciiAlnum(name).toUpperCase();
  if (words.length > 1) {
    const initials = words.map((w) => w[0]).join('').toUpperCase().slice(0, 10);
    candidates.push(initials);
  }
  for (const len of [3, 4, 5, 6, 8, 10]) candidates.push(joined.slice(0, len));
  for (const c of candidates) {
    if (c.length > 0 && isFree(c)) return c;
  }
  let base = (candidates.find((c) => /^[A-Z]/.test(c)) ?? '').slice(0, 3);
  if (!/^[A-Z]/.test(base)) base = 'TEAM';
  if (isFree(base)) return base;
  for (let i = 2; i < 10000; i++) {
    const suffix = String(i);
    const k = base.slice(0, 10 - suffix.length) + suffix;
    if (isFree(k)) return k;
  }
  throw new Error('could not suggest a team key');
}

/** URL slug: lowercase, unicode letters/digits kept, other runs -> '-', max 64 code points. */
export function slugify(s: string): string {
  const cleaned = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const cut = Array.from(cleaned).slice(0, 64).join('');
  return cut.replace(/-+$/g, '');
}
