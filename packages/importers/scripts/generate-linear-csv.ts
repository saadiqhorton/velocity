/* Writes an N-row Linear-format CSV (default 1000): node scripts/generate-linear-csv.ts [path] [rows] */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const LINEAR_HEADERS = [
  'ID', 'Team', 'Title', 'Description', 'Status', 'Estimate', 'Priority', 'Project ID', 'Project', 'Creator',
  'Assignee', 'Labels', 'Cycle Number', 'Cycle Name', 'Cycle Start', 'Cycle End', 'Created', 'Updated', 'Started',
  'Triaged', 'Completed', 'Canceled', 'Archived', 'Due Date', 'Parent issue', 'Project Milestone ID',
  'Project Milestone', 'Related to', 'Blocked by', 'Duplicate of',
];

const TEAMS: [string, string][] = [['ENG', 'Engineering'], ['DES', 'Design'], ['OPS', 'Operations']];
const STATUSES = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled'];
const PRIORITIES = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
const LABELS = ['Bug', 'Feature', 'Improvement', 'Design', 'Performance', 'Security'];
const PEOPLE = ['Alice Chen', 'Bob Martin', 'Carla Diaz', 'Dev Patel', ''];

function esc(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Deterministic CSV with `rows` issues across 3 teams, with parents, relations, cycles and projects. */
export function generateLinearCsv(rows = 1000): string {
  const lines = [LINEAR_HEADERS.map(esc).join(',')];
  const counters = new Map<string, number>();
  const ids: string[] = [];
  const base = Date.UTC(2024, 0, 1);
  for (let i = 0; i < rows; i++) {
    const [key, team] = TEAMS[i % TEAMS.length] as [string, string];
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    const id = `${key}-${n}`;
    const status = STATUSES[i % STATUSES.length] as string;
    const created = new Date(base + i * 3_600_000 * 5).toISOString();
    const cycle = Math.floor(n / 20) + 1;
    const cycleStart = new Date(base + (cycle - 1) * 14 * 86_400_000).toISOString();
    const cycleEnd = new Date(base + cycle * 14 * 86_400_000).toISOString();
    const sameTeam = ids.filter((x) => x.startsWith(`${key}-`));
    const parent = i % 7 === 6 && sameTeam.length ? (sameTeam[sameTeam.length - 1] as string) : '';
    const related = i % 11 === 10 && ids.length ? (ids[ids.length - 3] ?? '') : '';
    const blocked = i % 13 === 12 && ids.length ? (ids[ids.length - 2] ?? '') : '';
    const proj = i % 5 === 0 ? `Project ${(i % 4) + 1}` : '';
    const row = [
      id, team, `Issue ${i + 1}: handle "edge", case #${i}`,
      i % 4 === 0 ? `Line one\nLine two, with comma\n- [ ] task ${i}` : `Description ${i}`,
      status, String((i % 5) + 1), PRIORITIES[i % PRIORITIES.length] as string,
      proj ? `proj-${(i % 4) + 1}` : '', proj, PEOPLE[i % PEOPLE.length] as string,
      PEOPLE[(i + 1) % PEOPLE.length] as string,
      [LABELS[i % LABELS.length], LABELS[(i + 2) % LABELS.length]].join(', '),
      String(cycle), `Cycle ${cycle}`, cycleStart, cycleEnd, created, created,
      status === 'Backlog' || status === 'Todo' ? '' : created, '',
      status === 'Done' ? created : '', status === 'Canceled' ? created : '', '', '',
      parent, '', '', related, blocked, '',
    ];
    ids.push(id);
    lines.push(row.map(esc).join(','));
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? 'linear-export.csv';
  const n = Number(process.argv[3] ?? 1000);
  writeFileSync(out, generateLinearCsv(n));
  console.log(`Wrote ${n} rows to ${out}`);
}
