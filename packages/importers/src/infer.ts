import type { Priority, StatusCategory } from '@velocity/schema';

const RULES: [StatusCategory, RegExp][] = [
  ['canceled', /\b(cancel+ed|cancel+ing|won'?t do|will not do|wontfix|won'?t fix|duplicate|invalid|rejected|abandoned|obsolete)\b/],
  ['done', /\b(done|closed|resolved|complete|completed|shipped|released|merged|deployed|fixed|finished)\b/],
  ['todo', /\b(not started|unstarted)\b/],
  ['in_progress', /\b(in progress|progress|doing|started|in review|review|qa|testing|in test|blocked|in dev|wip|working)\b/],
  ['backlog', /\b(backlog|icebox|ice box|triage|someday|parked)\b/],
  ['todo', /\b(todo|to do|to-do|open|new|selected|ready|planned|reopened|queued|up next)\b/],
];

/** Keyword-based status category inference; null when the name is not recognised. */
export function inferStatusCategory(name: string): StatusCategory | null {
  const n = name.toLowerCase().replace(/[_]/g, ' ').trim();
  if (!n) return null;
  for (const [cat, re] of RULES) if (re.test(n)) return cat;
  return null;
}

/**
 * Suggest a team key (uppercase alphanumeric, starts with a letter, <= 10 chars) that is not in `taken`.
 * Multi-word names use initials ("Open Source Linear" -> OSL); single words use the first 3 chars.
 * Does not mutate `taken`.
 */
export function suggestTeamKey(name: string, taken: Set<string>): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let base = '';
  if (words.length > 1) base = words.map((w) => w[0] ?? '').join('');
  if (base.replace(/[^A-Za-z]/g, '').length < 2) base = words.join('');
  base = base.toUpperCase().replace(/^[0-9]+/, '');
  if (words.length <= 1 || base.length < 2) base = base.slice(0, 3);
  base = base.slice(0, 10);
  if (!base) base = 'TEAM';
  const takenUpper = new Set([...taken].map((k) => k.toUpperCase()));
  if (!takenUpper.has(base)) return base;
  for (let i = 2; i < 10000; i++) {
    const suffix = String(i);
    const cand = base.slice(0, 10 - suffix.length) + suffix;
    if (!takenUpper.has(cand)) return cand;
  }
  return base;
}

/** Linear API numbers: 0 none, 1 urgent, 2 high, 3 medium, 4 low -> Velocity 4,0,1,2,3. */
export function mapLinearApiPriority(n: number | null | undefined): Priority | null {
  switch (n) {
    case 0:
      return 4;
    case 1:
      return 0;
    case 2:
      return 1;
    case 3:
      return 2;
    case 4:
      return 3;
    default:
      return null;
  }
}

/** Linear CSV priority text. Empty -> 4 (none); unknown -> null. */
export function mapLinearCsvPriority(text: string | null | undefined): Priority | null {
  const t = (text ?? '').trim().toLowerCase();
  switch (t) {
    case '':
    case 'no priority':
    case 'none':
      return 4;
    case 'urgent':
      return 0;
    case 'high':
      return 1;
    case 'medium':
      return 2;
    case 'low':
      return 3;
    default:
      return null;
  }
}

/**
 * Jira priority map: Highest/Blocker/Critical -> 0 Urgent, High/Major -> 1, Medium -> 2,
 * Low/Minor/Lowest/Trivial -> 3, empty/none -> 4. Unknown -> null.
 */
export function mapJiraPriority(text: string | null | undefined): Priority | null {
  const t = (text ?? '').trim().toLowerCase();
  switch (t) {
    case '':
    case 'none':
    case 'no priority':
      return 4;
    case 'highest':
    case 'blocker':
    case 'critical':
      return 0;
    case 'high':
    case 'major':
      return 1;
    case 'medium':
    case 'normal':
      return 2;
    case 'low':
    case 'lowest':
    case 'minor':
    case 'trivial':
      return 3;
    default:
      return null;
  }
}
