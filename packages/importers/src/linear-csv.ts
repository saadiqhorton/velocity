import type { ImportBundle, ImportIssue } from '@velocity/schema';
import { inferStatusCategory, mapLinearCsvPriority } from './infer';
import {
  Collector,
  RelationResolver,
  capLabels,
  emptyBundle,
  normalizeEstimate,
  parseDate,
  readCsvRows,
  sanitizeKey,
  splitList,
  type CsvInput,
} from './util';

const ID_RE = /^(.+)-(\d+)$/;

/** Parse a Linear CSV export into an ImportBundle. Headers are case-insensitive; unknown columns are ignored. */
export async function parseLinearCsv(input: CsvInput): Promise<ImportBundle> {
  const c = new Collector();
  const rel = new RelationResolver();
  let cols: Map<string, number> | null = null;
  const parents: { issue: ImportIssue; parent: string }[] = [];
  const seenIds = new Set<string>();
  let rowNo = 1;

  for await (const row of readCsvRows(input)) {
    rowNo++;
    if (!cols) {
      cols = new Map();
      row.forEach((h, i) => {
        const k = h.trim().toLowerCase();
        if (k && !cols!.has(k)) cols!.set(k, i);
      });
      continue;
    }
    const get = (name: string): string => {
      const i = cols!.get(name);
      return i === undefined ? '' : (row[i] ?? '').trim();
    };
    const id = get('id');
    const title = get('title');
    const teamName = get('team');
    if (!id || !title || !teamName) {
      const missing = [!id && 'ID', !title && 'Title', !teamName && 'Team'].filter(Boolean).join(', ');
      c.warn('missing_required_field', `Row ${rowNo} skipped: missing ${missing}`, id || undefined);
      continue;
    }
    const m = ID_RE.exec(id);
    const teamKey = m ? sanitizeKey(m[1] ?? '') : '';
    if (!teamKey) {
      c.warn('invalid_issue_id', `Row ${rowNo} skipped: cannot derive a team key from ID "${id}"`, id);
      continue;
    }
    if (seenIds.has(id)) {
      c.warn('duplicate_issue', `Row ${rowNo} skipped: duplicate issue ID ${id}`, id);
      continue;
    }
    seenIds.add(id);

    if (!c.teams.has(teamKey)) c.teams.set(teamKey, { externalId: teamKey, key: teamKey, name: teamName });

    const statusName = get('status') || 'Backlog';
    c.addStatus({ teamExternalId: teamKey, name: statusName, category: inferStatusCategory(statusName) });

    const priorityText = get('priority');
    const priority = mapLinearCsvPriority(priorityText);
    if (priority === null) c.warn('unknown_priority', `Unknown priority "${priorityText}"`, id);

    let estimate: number | null = null;
    const est = get('estimate');
    if (est) {
      const n = Number(est);
      if (Number.isFinite(n)) {
        const r = normalizeEstimate(n);
        estimate = r.value;
        if (r.clamped) c.warn('estimate_clamped', `Estimate ${est} clamped to ${r.value}`, id);
      } else c.warn('invalid_estimate', `Estimate "${est}" is not a number`, id);
    }

    const userRef = (name: string): string | null => {
      if (!name) return null;
      const email = name.includes('@') ? name : null;
      c.addUser({ externalId: name, name, email });
      return name;
    };
    const assignee = userRef(get('assignee'));
    const creator = userRef(get('creator'));

    const labelNames = capLabels(splitList(get('labels')), c, id);
    for (const l of labelNames) c.addLabel(l);

    // Project + milestone
    const projectName = get('project');
    let projectExt: string | null = null;
    let milestoneExt: string | null = null;
    if (projectName) {
      projectExt = get('project id') || projectName;
      let p = c.projects.get(projectExt);
      if (!p) {
        p = { externalId: projectExt, name: projectName, milestones: [] };
        c.projects.set(projectExt, p);
      }
      const msName = get('project milestone');
      if (msName) {
        milestoneExt = get('project milestone id') || `${projectExt}:${msName}`;
        if (!p.milestones.some((x) => x.externalId === milestoneExt)) {
          p.milestones.push({ externalId: milestoneExt, name: msName });
        }
      }
    }

    // Cycle
    let cycleExt: string | null = null;
    const cycleNumber = Number.parseInt(get('cycle number'), 10);
    if (Number.isFinite(cycleNumber)) {
      cycleExt = `${teamKey}-cycle-${cycleNumber}`;
      if (!c.cycles.has(cycleExt)) {
        const s = parseDate(get('cycle start'));
        const e = parseDate(get('cycle end'));
        if (s && e) {
          c.cycles.set(cycleExt, {
            externalId: cycleExt,
            teamExternalId: teamKey,
            number: cycleNumber,
            name: get('cycle name') || null,
            startsAt: s,
            endsAt: e,
          });
        } else {
          c.warn('cycle_missing_dates', `Cycle ${cycleNumber} of ${teamKey} has no start/end dates; cycle skipped`, id);
          cycleExt = null;
        }
      }
    }

    const issue: ImportIssue = {
      externalId: id,
      teamExternalId: teamKey,
      title,
      descriptionMd: row[cols.get('description') ?? -1] ?? null,
      statusName,
      priority,
      estimate,
      assigneeExternalId: assignee,
      creatorExternalId: creator,
      labelNames,
      projectExternalId: projectExt,
      milestoneExternalId: milestoneExt,
      cycleExternalId: cycleExt,
      parentExternalId: null,
      relations: [],
      comments: [],
      createdAt: parseDate(get('created')),
      updatedAt: parseDate(get('updated')),
      completedAt: parseDate(get('completed')),
      canceledAt: parseDate(get('canceled')),
      archivedAt: parseDate(get('archived')),
      attachments: [],
    };
    if (issue.descriptionMd === '') issue.descriptionMd = null;
    c.issues.push(issue);

    const parent = get('parent issue');
    if (parent) parents.push({ issue, parent });
    for (const t of splitList(get('related to'))) rel.add(id, 'related', t);
    for (const t of splitList(get('blocked by'))) rel.add(t, 'blocks', id, id);
    for (const t of splitList(get('duplicate of'))) rel.add(id, 'duplicate', t);
  }

  if (!cols) return emptyBundle('linear', [{ code: 'empty_file', message: 'The CSV file is empty' }]);

  for (const { issue, parent } of parents) {
    if (parent !== issue.externalId && seenIds.has(parent)) issue.parentExternalId = parent;
    else c.warn('unknown_parent', `Parent issue ${parent} is not part of this import`, issue.externalId);
  }
  rel.apply(c.issues, c);
  return c.toBundle('linear');
}
