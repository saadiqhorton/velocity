import type { ImportBundle, ImportComment, ImportIssue } from '@velocity/schema';
import { inferStatusCategory, mapJiraPriority } from './infer';
import {
  Collector,
  RelationResolver,
  capLabels,
  emptyBundle,
  normalizeEstimate,
  parseDate,
  readCsvRows,
  sanitizeKey,
  type CsvInput,
} from './util';

const KEY_RE = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const JIRA_DATE_RE =
  /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;

/** Parse Jira's `12/Mar/24 3:45 PM` (interpreted as UTC) or ISO-like dates into an ISO string. */
export function parseJiraDate(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  const m = JIRA_DATE_RE.exec(s);
  if (m) {
    const mon = MONTHS.indexOf((m[2] ?? '').toLowerCase());
    if (mon < 0) return null;
    let year = Number(m[3]);
    if ((m[3] ?? '').length <= 2) year += 2000;
    let hour = m[4] ? Number(m[4]) : 0;
    const ampm = m[7]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    const t = Date.UTC(year, mon, Number(m[1]), hour, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return parseDate(s);
}

const POINT_HEADERS = ['custom field (story points)', 'story points', 'custom field (story point estimate)', 'story point estimate'];

/**
 * Parse a Jira CSV export. Jira repeats column names (Labels, Sprint, Comment, ...), so records are read as
 * arrays and headers handled manually.
 *
 * Mapping: project -> team (key = project key); issue type -> label in group "Type"; status -> workflow
 * status (category inferred by name, falling back to done when a Resolved date exists); priority
 * Highest/Blocker/Critical=0, High/Major=1, Medium=2, Low/Lowest/Minor/Trivial=3, none=4; sprint -> cycle
 * (last sprint listed wins; dates are estimated from member issues); story points -> estimate (rounded, 0-40).
 */
export async function parseJiraCsv(input: CsvInput): Promise<ImportBundle> {
  const c = new Collector();
  const rel = new RelationResolver();
  let headers: string[] | null = null;
  const idx = new Map<string, number[]>();
  const keyById = new Map<string, string>();
  const parentRefs: { issue: ImportIssue; ref: string }[] = [];
  const sprintMembers = new Map<string, { teamKey: string; name: string; created: number[]; ends: number[] }>();
  const issueSprint = new Map<ImportIssue, string>();
  const unknownLinkTypes = new Set<string>();
  const seen = new Set<string>();
  let rowNo = 1;

  for await (const row of readCsvRows(input)) {
    rowNo++;
    if (!headers) {
      headers = row.map((h) => h.trim().toLowerCase());
      headers.forEach((h, i) => {
        const l = idx.get(h);
        if (l) l.push(i);
        else idx.set(h, [i]);
      });
      continue;
    }
    const all = (name: string): string[] =>
      (idx.get(name) ?? []).map((i) => (row[i] ?? '').trim()).filter(Boolean);
    const first = (name: string): string => all(name)[0] ?? '';

    const key = first('issue key');
    const title = first('summary');
    if (!key || !title) {
      c.warn('missing_required_field', `Row ${rowNo} skipped: missing ${!key ? 'Issue key' : 'Summary'}`, key || undefined);
      continue;
    }
    const km = KEY_RE.exec(key);
    if (!km) {
      c.warn('invalid_issue_key', `Row ${rowNo} skipped: "${key}" is not a Jira issue key`, key);
      continue;
    }
    if (seen.has(key)) {
      c.warn('duplicate_issue', `Row ${rowNo} skipped: duplicate issue key ${key}`, key);
      continue;
    }
    seen.add(key);
    const projectKey = sanitizeKey(first('project key') || (km[1] ?? ''));
    if (!projectKey) {
      c.warn('missing_team', `Row ${rowNo} skipped: cannot derive project key`, key);
      continue;
    }
    if (!c.teams.has(projectKey)) {
      c.teams.set(projectKey, {
        externalId: projectKey,
        key: projectKey,
        name: first('project name') || projectKey,
      });
    }
    const issueId = first('issue id');
    if (issueId) keyById.set(issueId, key);

    const statusName = first('status') || 'To Do';
    let category = inferStatusCategory(statusName);
    const resolved = parseJiraDate(first('resolved'));
    if (!category && resolved) category = 'done';
    c.addStatus({ teamExternalId: projectKey, name: statusName, category });
    if (!category) c.warn('unknown_status_category', `Status "${statusName}" could not be categorised`, key);

    const prioText = first('priority');
    const priority = mapJiraPriority(prioText);
    if (priority === null) c.warn('unknown_priority', `Unknown priority "${prioText}"`, key);

    // Labels: issue type (group Type) + repeated Labels columns
    const labelNames: string[] = [];
    const type = first('issue type');
    if (type) {
      c.addLabel(type, 'Type');
      labelNames.push(type);
    }
    for (const l of all('labels')) {
      c.addLabel(l);
      labelNames.push(l);
    }

    // Story points
    let estimate: number | null = null;
    for (const h of POINT_HEADERS) {
      const v = first(h);
      if (!v) continue;
      const n = Number(v);
      if (Number.isFinite(n)) {
        const r = normalizeEstimate(n);
        estimate = r.value;
        if (r.clamped) c.warn('estimate_clamped', `Story points ${v} clamped to ${r.value}`, key);
      } else c.warn('invalid_estimate', `Story points "${v}" is not a number`, key);
      break;
    }

    const userRef = (nameCol: string, idCol: string): string | null => {
      const name = first(nameCol);
      const id = first(idCol);
      const ext = id || name;
      if (!ext) return null;
      c.addUser({ externalId: ext, name: name || ext, email: name.includes('@') ? name : null });
      return ext;
    };
    const assignee = userRef('assignee', 'assignee id');
    const creator = userRef('creator', 'creator id') ?? userRef('reporter', 'reporter id');

    // Comments: "12/Mar/24 3:45 PM;author;body"
    const comments: ImportComment[] = [];
    for (const raw of all('comment')) {
      const m = /^([^;]*);([^;]*);([\s\S]*)$/.exec(raw);
      const date = m ? parseJiraDate(m[1]) : null;
      if (m && date) {
        const author = (m[2] ?? '').trim();
        if (author) c.addUser({ externalId: author, name: author });
        comments.push({
          authorExternalId: author || null,
          authorName: author || null,
          bodyMd: (m[3] ?? '').trim(),
          createdAt: date,
        });
      } else comments.push({ bodyMd: raw });
    }

    const attachments: { name: string; url: string }[] = [];
    for (const raw of all('attachment')) {
      const parts = raw.split(';');
      if (parts.length >= 3) attachments.push({ name: (parts[parts.length - 2] ?? '').trim(), url: (parts[parts.length - 1] ?? '').trim() });
    }

    const createdAt = parseJiraDate(first('created'));
    const updatedAt = parseJiraDate(first('updated'));
    const issue: ImportIssue = {
      externalId: key,
      teamExternalId: projectKey,
      title,
      descriptionMd: first('description') || null,
      statusName,
      priority,
      estimate,
      assigneeExternalId: assignee,
      creatorExternalId: creator,
      labelNames: capLabels(labelNames, c, key),
      projectExternalId: null,
      milestoneExternalId: null,
      cycleExternalId: null,
      parentExternalId: null,
      relations: [],
      comments,
      createdAt,
      updatedAt,
      completedAt: category === 'done' ? resolved : null,
      canceledAt: category === 'canceled' ? resolved : null,
      archivedAt: null,
      attachments,
    };
    c.issues.push(issue);

    // Sprint: last one listed is the current one
    const sprints = all('sprint');
    const sprint = sprints[sprints.length - 1];
    if (sprint) {
      const sk = `${projectKey}:${sprint}`;
      let sm = sprintMembers.get(sk);
      if (!sm) {
        sm = { teamKey: projectKey, name: sprint, created: [], ends: [] };
        sprintMembers.set(sk, sm);
      }
      const cr = createdAt ? Date.parse(createdAt) : NaN;
      if (!Number.isNaN(cr)) sm.created.push(cr);
      const en = Date.parse(resolved ?? updatedAt ?? '');
      if (!Number.isNaN(en)) sm.ends.push(en);
      issueSprint.set(issue, sk);
    }

    // Parent
    const parentRef = first('parent') || first('parent id');
    if (parentRef) parentRefs.push({ issue, ref: parentRef });

    // Links
    for (const h of idx.keys()) {
      const lm = /^(inward|outward) issue link \((.+)\)$/.exec(h);
      if (!lm) continue;
      const dir = lm[1];
      const linkType = (lm[2] ?? '').toLowerCase();
      for (const target of all(h)) {
        if (linkType === 'blocks' || linkType === 'blocker') {
          if (dir === 'outward') rel.add(key, 'blocks', target);
          else rel.add(target, 'blocks', key, key);
        } else if (linkType.startsWith('duplicate')) {
          if (dir === 'outward') rel.add(key, 'duplicate', target);
          else rel.add(target, 'duplicate', key, key);
        } else {
          if (!['relates', 'relate', 'related'].includes(linkType) && !unknownLinkTypes.has(linkType)) {
            unknownLinkTypes.add(linkType);
            c.warn('unknown_link_type', `Link type "${lm[2]}" imported as "related"`, key);
          }
          rel.add(key, 'related', target);
        }
      }
    }
  }

  if (!headers) return emptyBundle('jira', [{ code: 'empty_file', message: 'The CSV file is empty' }]);

  for (const { issue, ref } of parentRefs) {
    const resolved = seen.has(ref) ? ref : keyById.get(ref);
    if (resolved && resolved !== issue.externalId) issue.parentExternalId = resolved;
    else c.warn('unknown_parent', `Parent ${ref} is not part of this import`, issue.externalId);
  }
  rel.apply(c.issues, c);

  // Sprints -> cycles, numbered sequentially per team ordered by estimated start.
  const byTeam = new Map<string, { sk: string; start: number; end: number; name: string }[]>();
  for (const [sk, sm] of sprintMembers) {
    const start = sm.created.length ? Math.min(...sm.created) : 0;
    let end = sm.ends.length ? Math.max(...sm.ends) : start;
    if (end <= start) end = start + 14 * 86_400_000;
    const list = byTeam.get(sm.teamKey) ?? [];
    list.push({ sk, start, end, name: sm.name });
    byTeam.set(sm.teamKey, list);
  }
  for (const [teamKey, list] of byTeam) {
    list.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
    list.forEach((s, i) => {
      const ext = `${teamKey}:${s.name}`;
      c.cycles.set(ext, {
        externalId: ext,
        teamExternalId: teamKey,
        number: i + 1,
        name: s.name,
        startsAt: new Date(s.start).toISOString(),
        endsAt: new Date(s.end).toISOString(),
      });
      c.warn('sprint_dates_estimated', `Sprint "${s.name}" has no dates in the CSV; dates estimated from member issues`, ext);
    });
  }
  for (const [issue, sk] of issueSprint) issue.cycleExternalId = sk;

  return c.toBundle('jira');
}
