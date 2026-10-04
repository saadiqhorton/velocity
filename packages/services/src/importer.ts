import { and, asc, desc, eq, getTableColumns, inArray, isNull, max, sql } from 'drizzle-orm';
import {
  comments,
  cycles,
  importItems,
  importRuns,
  issues,
  labels,
  milestones,
  projectTeams,
  projects,
  statuses,
  teams,
  users,
} from '@velocity/schema';
import type {
  ImportBundle,
  ImportComment,
  ImportCycle,
  ImportDryRunReport,
  ImportIssue,
  ImportMapping,
  ImportSource,
  ImportWarning,
  ImportWorkspaceSnapshot,
  PaletteColor,
  RelationType,
  StatusCategory,
} from '@velocity/schema';
import { MAX_LABELS_PER_ISSUE, MAX_SUB_ISSUE_DEPTH, TEAM_KEY_RE } from '@velocity/schema';
import { publish } from '@velocity/events';
import {
  BundleValidationError,
  fetchGithubIssues,
  fetchLinearApi,
  parseJiraCsv,
  parseLinearCsv,
  suggestMapping,
  validateBundle,
} from '@velocity/importers';
import { z } from 'zod';
import { ServiceBase } from './base';
import type { AuditService } from './audit';
import { actorUserId, systemActor } from './context';
import type { ServiceActor } from './context';
import type { DbOrTx } from './db';
import { ServiceError, notFound, validation } from './errors';
import type { IssueService } from './issues';
import type { LabelService } from './labels';
import { DEFAULT_STATUSES } from './teams';
import type { TeamService } from './teams';
import type { CommentService } from './comments';
import { sanitizeMarkdown } from './lib/markdown';
import { assertCan } from './lib/permissions';

export type ImportRunRow = typeof importRuns.$inferSelect;

/** Counts of what a finished (or partially finished) commit actually created. */
export interface ImportResult {
  counts: {
    teams: number;
    statuses: number;
    labels: number;
    projects: number;
    milestones: number;
    cycles: number;
    issues: number;
    comments: number;
    relations: number;
    parents: number;
    /** Issues the importer tried but the domain layer rejected (see warnings). */
    issuesFailed: number;
  };
  warnings: ImportWarning[];
}

/** What `report` holds once a run has committed: the dry-run fields plus actual numbers. */
export interface ImportCommittedReport extends ImportDryRunReport {
  dryRun: ImportDryRunReport;
  result: ImportResult;
}

// Run rows without the (potentially huge) bundle: `config` comes back as `{}`.
const { config: _bundleColumn, ...RUN_COLUMNS } = getTableColumns(importRuns);
void _bundleColumn;
const SLIM = { ...RUN_COLUMNS, config: sql<unknown>`'{}'::jsonb`.as('config') };

const STATUS_COLORS: Record<StatusCategory, PaletteColor> = {
  backlog: 'grey',
  todo: 'blue',
  in_progress: 'yellow',
  done: 'green',
  canceled: 'grey',
};

const UUID_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidStr = z.string().regex(UUID_LOOSE, 'Expected an id.');
const mappingSchema = z.object({
  teams: z.record(
    z.string(),
    z.union([
      z.object({ mode: z.literal('existing'), teamId: uuidStr }),
      z.object({ mode: z.literal('create'), key: z.string(), name: z.string().trim().min(1).max(64) }),
    ]),
  ),
  statuses: z.record(
    z.string(),
    z.union([
      z.object({ mode: z.literal('existing'), statusId: uuidStr }),
      z.object({
        mode: z.literal('create'),
        name: z.string().trim().min(1).max(32),
        category: z.enum(['backlog', 'todo', 'in_progress', 'done', 'canceled']),
      }),
    ]),
  ),
  users: z.record(z.string(), z.union([z.object({ userId: uuidStr }), z.null()])),
  include: z.object({
    projects: z.boolean(),
    cycles: z.boolean(),
    comments: z.boolean(),
    relations: z.boolean(),
    archived: z.boolean(),
  }),
});

const lc = (s: string): string => s.trim().toLowerCase();
const statusKey = (teamExt: string, name: string): string => `${teamExt}::${name}`;
const statusName = (n: string): string => n.trim().slice(0, 32);
const labelName = (n: string): string => n.trim().slice(0, 48);

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateOnly(s: string | null | undefined): string | null {
  const m = s ? /^(\d{4}-\d{2}-\d{2})/.exec(s) : null;
  return m?.[1] ?? null;
}

function redact(message: string, secrets: string[]): string {
  let out = message;
  for (const s of secrets) if (s) out = out.split(s).join('[redacted]');
  return out;
}

// ───────────── Pure planning (shared by dryRun and commit so the two can never disagree) ─────────────

interface PlannedLabel {
  key: string;
  name: string;
  group: string | null;
  isGroup: boolean;
}
interface Plan {
  issues: ImportIssue[];
  skipped: number;
  labels: PlannedLabel[];
  projects: ImportBundle['projects'];
  cycles: ImportCycle[];
  comments: { key: string; issueExt: string; comment: ImportComment }[];
  relations: { key: string; src: string; tgt: string; type: RelationType }[];
  parents: { child: string; parent: string }[];
  warnings: ImportWarning[];
}

function planParents(list: ImportIssue[], imported: Set<string>, warnings: ImportWarning[]): { child: string; parent: string }[] {
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  const level = (id: string): number => {
    let l = 1;
    for (let cur = parentOf.get(id); cur !== undefined; cur = parentOf.get(cur)) l++;
    return l;
  };
  const height = (id: string): number => 1 + Math.max(0, ...(childrenOf.get(id) ?? []).map(height));
  const out: { child: string; parent: string }[] = [];
  for (const i of list) {
    const p = i.parentExternalId;
    if (!p) continue;
    if (p === i.externalId) {
      warnings.push({ code: 'parent_self', message: `${i.externalId} lists itself as its parent; skipped.`, externalId: i.externalId });
      continue;
    }
    if (!imported.has(p)) {
      warnings.push({ code: 'parent_outside_import', message: `Parent ${p} of ${i.externalId} is not part of this import; the parent link was skipped.`, externalId: i.externalId });
      continue;
    }
    let loop = false;
    for (let cur: string | undefined = p; cur !== undefined; cur = parentOf.get(cur)) {
      if (cur === i.externalId) {
        loop = true;
        break;
      }
    }
    if (loop) {
      warnings.push({ code: 'parent_loop', message: `Parent link ${i.externalId} → ${p} would create a loop; skipped.`, externalId: i.externalId });
      continue;
    }
    if (level(p) + height(i.externalId) > MAX_SUB_ISSUE_DEPTH) {
      warnings.push({ code: 'parent_depth_exceeded', message: `Parent link ${i.externalId} → ${p} would nest sub-issues deeper than ${MAX_SUB_ISSUE_DEPTH} levels; skipped.`, externalId: i.externalId });
      continue;
    }
    parentOf.set(i.externalId, p);
    childrenOf.set(p, [...(childrenOf.get(p) ?? []), i.externalId]);
    out.push({ child: i.externalId, parent: p });
  }
  return out;
}

function buildPlan(bundle: ImportBundle, mapping: ImportMapping): Plan {
  const warnings: ImportWarning[] = [];
  const seen = new Set<string>();
  const kept: ImportIssue[] = [];
  let skipped = 0;
  for (const i of bundle.issues) {
    if (seen.has(i.externalId)) {
      skipped++;
      warnings.push({ code: 'duplicate_issue', message: `Issue ${i.externalId} appears more than once; only the first is imported.`, externalId: i.externalId });
      continue;
    }
    seen.add(i.externalId);
    if (!mapping.teams[i.teamExternalId]) {
      skipped++;
      warnings.push({ code: 'team_unmapped', message: `Issue ${i.externalId} belongs to team ${i.teamExternalId}, which is not mapped; skipped.`, externalId: i.externalId });
      continue;
    }
    if (!mapping.include.archived && i.archivedAt) {
      skipped++;
      continue;
    }
    kept.push(i);
  }
  const imported = new Set(kept.map((i) => i.externalId));

  // Labels (groups first so children can reference them).
  const labelMap = new Map<string, PlannedLabel>();
  const groups = new Map<string, PlannedLabel>();
  const addLabel = (rawName: string, rawGroup: string | null | undefined): void => {
    const name = labelName(rawName);
    if (!name) return;
    const key = lc(name);
    const group = rawGroup && labelName(rawGroup) ? labelName(rawGroup) : null;
    if (group && !groups.has(lc(group))) groups.set(lc(group), { key: lc(group), name: group, group: null, isGroup: true });
    if (!labelMap.has(key)) labelMap.set(key, { key, name, group, isGroup: false });
  };
  for (const l of bundle.labels) addLabel(l.name, l.group);
  for (const i of kept) for (const n of i.labelNames) addLabel(n, null);
  const labelList = [...groups.values(), ...[...labelMap.values()].filter((l) => !groups.has(l.key))];

  const projectList = mapping.include.projects ? bundle.projects : [];
  const cycleList = mapping.include.cycles
    ? bundle.cycles.filter((c) => mapping.teams[c.teamExternalId] && parseDate(c.startsAt) && parseDate(c.endsAt))
    : [];

  const commentList: Plan['comments'] = [];
  if (mapping.include.comments) {
    for (const i of kept) {
      i.comments.forEach((c, idx) => {
        if (c.bodyMd.trim()) commentList.push({ key: `${i.externalId}#${idx}`, issueExt: i.externalId, comment: c });
      });
    }
  }

  const relations: Plan['relations'] = [];
  if (mapping.include.relations) {
    const relSeen = new Set<string>();
    for (const i of kept) {
      for (const r of i.relations) {
        if (r.targetExternalId === i.externalId || !imported.has(r.targetExternalId)) continue;
        const pair = [i.externalId, r.targetExternalId].sort().join('|');
        const key = `${r.type}|${pair}`;
        if (relSeen.has(key)) continue;
        relSeen.add(key);
        relations.push({ key, src: i.externalId, tgt: r.targetExternalId, type: r.type });
      }
    }
  }

  const parentWarnings: ImportWarning[] = [];
  const parentList = planParents(kept, imported, parentWarnings);
  warnings.push(...parentWarnings);

  return { issues: kept, skipped, labels: labelList, projects: projectList, cycles: cycleList, comments: commentList, relations, parents: parentList, warnings };
}

interface CommitCtx {
  run: ImportRunRow;
  bundle: ImportBundle;
  mapping: ImportMapping;
  plan: Plan;
  actor: ServiceActor;
  teamIds: Map<string, string>;
  statusIds: Map<string, string>;
  labelIds: Map<string, string>;
  labelGroupIds: Set<string>;
  projectIds: Map<string, string>;
  milestoneIds: Map<string, string>;
  milestoneProject: Map<string, string>;
  cycleIds: Map<string, string>;
  issueIds: Map<string, string>;
  userIds: Map<string, { id: string; assignable: boolean }>;
  warnings: ImportWarning[];
}

const PHASE = { setup: 0.05, issues: 0.8, comments: 0.9, parents: 0.95 } as const;

export class ImporterService extends ServiceBase {
  protected audit!: AuditService;
  protected issueService!: IssueService;
  protected teamService!: TeamService;
  protected labelService!: LabelService;
  protected commentService!: CommentService;

  /** Test hook: inject `fetch` for createRunFromApi (the importers accept an injectable fetch). */
  fetchImpl: typeof fetch | undefined = undefined;
  /**
   * Test hook: when set to N, `runCommit` throws an injected error right after the Nth issue
   * chunk of that invocation has been committed (simulates a crash mid-import). Never set in production.
   */
  failAfterChunks: number | null = null;
  /** Rows per transaction (SPEC §6.7: 500). Public so tests can shrink it. */
  chunkSize = 500;

  bind(deps: { audit: AuditService; issues: IssueService; teams: TeamService; labels: LabelService; comments: CommentService }): void {
    this.audit = deps.audit;
    this.issueService = deps.issues;
    this.teamService = deps.teams;
    this.labelService = deps.labels;
    this.commentService = deps.comments;
  }

  // ───────────── Run creation ─────────────

  async createRun(actor: ServiceActor, input: { source: ImportSource; bundle: unknown; fileName?: string | null }): Promise<ImportRunRow> {
    assertCan(actor, 'workspace.import_export');
    let bundle: ImportBundle;
    try {
      bundle = validateBundle(input.bundle);
    } catch (err) {
      if (err instanceof BundleValidationError) throw validation(err.message, { issues: err.issues.slice(0, 50) });
      throw err;
    }
    const snapshot = await this.snapshot();
    const suggested = suggestMapping(bundle, snapshot);
    return this.tx(async (tx) => {
      const [row] = await tx
        .insert(importRuns)
        .values({
          source: input.source,
          status: 'mapping',
          fileName: input.fileName ?? null,
          config: bundle,
          suggestedMapping: suggested,
          mapping: suggested,
          createdBy: actorUserId(actor),
        })
        .returning(SLIM);
      if (!row) throw new Error('import run insert failed');
      await this.audit.log(tx, actor, {
        action: 'import.started',
        objectType: 'import_run',
        objectId: row.id,
        changes: {
          source: input.source,
          fileName: input.fileName ?? null,
          counts: { teams: bundle.teams.length, issues: bundle.issues.length, projects: bundle.projects.length, cycles: bundle.cycles.length, users: bundle.users.length },
        },
      });
      return row;
    });
  }

  async createRunFromCsv(actor: ServiceActor, input: { source: 'linear' | 'jira'; csv: string; fileName?: string | null }): Promise<ImportRunRow> {
    assertCan(actor, 'workspace.import_export');
    let bundle: ImportBundle;
    try {
      bundle = input.source === 'linear' ? await parseLinearCsv(input.csv) : await parseJiraCsv(input.csv);
    } catch (err) {
      throw validation(`Couldn’t read that ${input.source} CSV: ${err instanceof Error ? err.message : String(err)}`);
    }
    return this.createRun(actor, { source: input.source, bundle, fileName: input.fileName ?? null });
  }

  async createRunFromApi(
    actor: ServiceActor,
    input: { source: 'linear'; apiKey: string; teamKeys?: string[] | null } | { source: 'github'; token: string; repos: string[] },
  ): Promise<ImportRunRow> {
    assertCan(actor, 'workspace.import_export');
    const secret = input.source === 'linear' ? input.apiKey : input.token;
    let bundle: ImportBundle;
    try {
      bundle =
        input.source === 'linear'
          ? await fetchLinearApi({ apiKey: input.apiKey, ...(input.teamKeys?.length ? { teamKeys: input.teamKeys } : {}), ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}) })
          : await fetchGithubIssues({ token: input.token, repos: input.repos, ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}) });
    } catch (err) {
      // Never let the credential leak through an upstream error message.
      throw validation(`Couldn’t fetch from ${input.source}: ${redact(err instanceof Error ? err.message : String(err), [secret])}`);
    }
    return this.createRun(actor, { source: input.source, bundle, fileName: input.source === 'linear' ? 'linear-api' : 'github-api' });
  }

  private async snapshot(): Promise<ImportWorkspaceSnapshot> {
    const [teamRows, statusRows, userRows, labelRows] = await Promise.all([
      this.db.select().from(teams).where(and(isNull(teams.deletedAt), isNull(teams.archivedAt))).orderBy(asc(teams.sortOrder)),
      this.db.select().from(statuses).where(isNull(statuses.archivedAt)),
      this.db.select().from(users).where(isNull(users.deletedAt)),
      this.db.select().from(labels).where(isNull(labels.archivedAt)),
    ]);
    return {
      teams: teamRows.map((t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        statuses: statusRows.filter((s) => s.teamId === t.id).map((s) => ({ id: s.id, name: s.name, category: s.category })),
      })),
      users: userRows.map((u) => ({ id: u.id, username: u.username, name: u.name, email: u.email ?? null })),
      labels: labelRows.map((l) => ({ id: l.id, name: l.name })),
    };
  }

  // ───────────── Mapping ─────────────

  async updateMapping(actor: ServiceActor, id: string, mappingInput: unknown): Promise<ImportRunRow> {
    assertCan(actor, 'workspace.import_export');
    const run = await this.requireRun(id);
    if (run.status !== 'mapping' && run.status !== 'ready') throw validation(`This import is ${run.status}; its mapping can no longer be changed.`);
    const parsed = mappingSchema.safeParse(mappingInput);
    if (!parsed.success) {
      throw validation(`Invalid mapping: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    }
    const mapping = parsed.data as ImportMapping;
    const bundle = await this.loadBundle(id);

    const bundleTeams = new Set(bundle.teams.map((t) => t.externalId));
    for (const ext of Object.keys(mapping.teams)) if (!bundleTeams.has(ext)) throw validation(`Unknown team “${ext}” in the mapping.`);
    for (const ext of bundleTeams) if (!mapping.teams[ext]) throw validation(`Team “${ext}” needs a mapping.`);

    const existingTeamIds = new Set<string>();
    const newKeys = new Set<string>();
    for (const [ext, t] of Object.entries(mapping.teams)) {
      if (t.mode === 'existing') existingTeamIds.add(t.teamId);
      else {
        const key = t.key.trim().toUpperCase();
        if (!TEAM_KEY_RE.test(key)) throw validation(`Team key “${t.key}” is invalid. Use 1–10 uppercase letters or digits starting with a letter.`, { team: ext });
        if (newKeys.has(key)) throw validation(`Team key ${key} is used twice in this mapping.`, { team: ext });
        newKeys.add(key);
        mapping.teams[ext] = { mode: 'create', key, name: t.name.trim() };
      }
    }
    if (existingTeamIds.size) {
      const found = await this.db.select({ id: teams.id }).from(teams).where(and(inArray(teams.id, [...existingTeamIds]), isNull(teams.deletedAt), isNull(teams.archivedAt)));
      if (found.length !== existingTeamIds.size) throw validation('One of the mapped teams doesn’t exist (or is archived).');
    }
    if (newKeys.size) {
      const clash = await this.db.select({ key: teams.key }).from(teams).where(inArray(teams.key, [...newKeys]));
      if (clash.length) throw validation(`A team with key ${clash[0]!.key} already exists.`, { field: 'key' });
    }

    const bundleStatusKeys = new Set(bundle.statuses.map((s) => statusKey(s.teamExternalId, s.name)));
    const existingStatusIds = new Set<string>();
    for (const [key, s] of Object.entries(mapping.statuses)) {
      if (!bundleStatusKeys.has(key)) throw validation(`Unknown status “${key}” in the mapping.`);
      if (s.mode === 'existing') existingStatusIds.add(s.statusId);
    }
    if (existingStatusIds.size) {
      const rows = await this.db.select().from(statuses).where(inArray(statuses.id, [...existingStatusIds]));
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const [key, s] of Object.entries(mapping.statuses)) {
        if (s.mode !== 'existing') continue;
        const row = byId.get(s.statusId);
        if (!row || row.archivedAt) throw validation(`Status for “${key}” doesn’t exist.`);
        const teamExt = key.slice(0, key.indexOf('::'));
        const target = mapping.teams[teamExt];
        if (!target || target.mode !== 'existing' || target.teamId !== row.teamId) {
          throw validation(`Status for “${key}” must belong to the team it is mapped to.`);
        }
      }
    }

    const userIds = [...new Set(Object.values(mapping.users).filter((u): u is { userId: string } => u !== null).map((u) => u.userId))];
    if (userIds.length) {
      const found = await this.db.select({ id: users.id }).from(users).where(and(inArray(users.id, userIds), isNull(users.deletedAt)));
      if (found.length !== userIds.length) throw validation('One of the mapped members doesn’t exist.');
    }

    const [row] = await this.db
      .update(importRuns)
      .set({ mapping, status: 'mapping', report: null, error: null, updatedAt: this.now() })
      .where(eq(importRuns.id, id))
      .returning(SLIM);
    if (!row) throw notFound('Import run');
    return row;
  }

  // ───────────── Dry run ─────────────

  async dryRun(actor: ServiceActor, id: string): Promise<ImportRunRow> {
    assertCan(actor, 'workspace.import_export');
    const run = await this.requireRun(id);
    if (run.status !== 'mapping' && run.status !== 'ready') throw validation(`This import is ${run.status}; it can’t be dry-run.`);
    const bundle = await this.loadBundle(id);
    const mapping = this.mappingOf(run);
    const plan = buildPlan(bundle, mapping);

    const existingTeamIds = Object.values(mapping.teams).flatMap((t) => (t.mode === 'existing' ? [t.teamId] : []));
    const [labelRows, projectRows, statusRows, cycleRows] = await Promise.all([
      this.db.select({ name: labels.name }).from(labels),
      this.db.select({ name: projects.name }).from(projects).where(isNull(projects.trashedAt)),
      existingTeamIds.length
        ? this.db.select({ teamId: statuses.teamId, name: statuses.name }).from(statuses).where(and(inArray(statuses.teamId, existingTeamIds), isNull(statuses.archivedAt)))
        : Promise.resolve([] as { teamId: string; name: string }[]),
      existingTeamIds.length
        ? this.db.select({ teamId: cycles.teamId, number: cycles.number }).from(cycles).where(inArray(cycles.teamId, existingTeamIds))
        : Promise.resolve([] as { teamId: string; number: number }[]),
    ]);

    const teamsToCreate = Object.values(mapping.teams).filter((t) => t.mode === 'create').length;

    const existingStatusNames = new Set(statusRows.map((s) => `${s.teamId}::${lc(s.name)}`));
    const newStatuses = new Set<string>();
    const unmappedStatuses: string[] = [];
    const bundleStatus = new Map(bundle.statuses.map((s) => [statusKey(s.teamExternalId, s.name), s]));
    for (const [key, m] of Object.entries(mapping.statuses)) {
      if (m.mode !== 'create') continue;
      const teamExt = key.slice(0, key.indexOf('::'));
      const team = mapping.teams[teamExt];
      if (!team) continue;
      const scope = team.mode === 'existing' ? team.teamId : `new:${teamExt}`;
      const dedupe = `${scope}::${lc(statusName(m.name))}`;
      // New teams start with the default workflow, so matching names are reused rather than created.
      if (team.mode === 'existing' ? existingStatusNames.has(dedupe) : DEFAULT_STATUSES.some((d) => lc(d.name) === lc(statusName(m.name)))) continue;
      newStatuses.add(dedupe);
      if (bundleStatus.get(key)?.category === null) unmappedStatuses.push(key);
    }

    const existingLabels = new Set(labelRows.map((l) => lc(l.name)));
    const labelsToCreate = plan.labels.filter((l) => !existingLabels.has(l.key)).length;

    const existingProjects = new Set(projectRows.map((p) => lc(p.name)));
    const newProjects = new Set(plan.projects.map((p) => lc(p.name)).filter((n) => !existingProjects.has(n)));

    const existingCycles = new Set(cycleRows.map((c) => `${c.teamId}:${c.number}`));
    const newCycles = new Set<string>();
    for (const c of plan.cycles) {
      const team = mapping.teams[c.teamExternalId];
      if (!team) continue;
      const scope = team.mode === 'existing' ? team.teamId : `new:${c.teamExternalId}`;
      const key = `${scope}:${c.number}`;
      if (!existingCycles.has(key)) newCycles.add(key);
    }

    // Users that issues actually reference and that the mapping leaves unresolved.
    const refs = new Set<string>();
    for (const i of plan.issues) {
      if (i.assigneeExternalId) refs.add(i.assigneeExternalId);
      if (i.creatorExternalId) refs.add(i.creatorExternalId);
    }
    for (const c of plan.comments) if (c.comment.authorExternalId) refs.add(c.comment.authorExternalId);
    const unmappedUsers = [...refs].filter((u) => !mapping.users[u]).sort();

    const report: ImportDryRunReport = {
      counts: {
        teamsToCreate,
        statusesToCreate: newStatuses.size,
        labelsToCreate,
        projectsToCreate: newProjects.size,
        cyclesToCreate: newCycles.size,
        issues: plan.issues.length,
        comments: plan.comments.length,
        relations: plan.relations.length,
        skippedIssues: plan.skipped,
      },
      unmapped: {
        users: unmappedUsers,
        statuses: unmappedStatuses,
        teams: bundle.teams.filter((t) => !mapping.teams[t.externalId]).map((t) => t.externalId),
      },
      warnings: [...bundle.warnings, ...plan.warnings],
    };
    const [row] = await this.db
      .update(importRuns)
      .set({ report, status: 'ready', error: null, updatedAt: this.now() })
      .where(eq(importRuns.id, id))
      .returning(SLIM);
    if (!row) throw notFound('Import run');
    return row;
  }

  // ───────────── Commit ─────────────

  async commit(actor: ServiceActor, id: string): Promise<ImportRunRow> {
    assertCan(actor, 'workspace.import_export');
    const run = await this.requireRun(id);
    if (run.status !== 'ready' && run.status !== 'failed') {
      throw validation(run.status === 'mapping' ? 'Run the dry-run report before committing.' : `This import is ${run.status}; it can’t be committed.`);
    }
    if (!run.report) throw validation('Run the dry-run report before committing.');
    const [row] = await this.db
      .update(importRuns)
      .set({ status: 'committing', error: null, ...(run.status === 'ready' ? { progress: 0, committedCount: 0 } : {}), updatedAt: this.now() })
      .where(and(eq(importRuns.id, id), inArray(importRuns.status, ['ready', 'failed'])))
      .returning(SLIM);
    if (!row) throw validation('This import is already running.');
    await this.jobs.send('importers', { type: 'commit', runId: id });
    return row;
  }

  /** Job entry point. Resumable and idempotent: every created entity is recorded in import_items. */
  async runCommit(runId: string): Promise<void> {
    const [run] = await this.db.select().from(importRuns).where(eq(importRuns.id, runId));
    if (!run || run.status !== 'committing') return;
    try {
      const done = await this.execute(run);
      if (!done) return; // canceled
    } catch (err) {
      this.logger.error({ err, runId }, 'import commit failed');
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
      await this.db
        .update(importRuns)
        .set({ status: 'failed', error: message, updatedAt: this.now() })
        .where(and(eq(importRuns.id, runId), eq(importRuns.status, 'committing')));
      throw err;
    }
  }

  private async execute(run: ImportRunRow): Promise<boolean> {
    const bundle = validateBundle(run.config);
    const mapping = this.mappingOf(run);
    const actor = systemActor('import', run.createdBy ?? null);
    const ctx: CommitCtx = {
      run,
      bundle,
      mapping,
      plan: buildPlan(bundle, mapping),
      actor,
      teamIds: new Map(),
      statusIds: new Map(),
      labelIds: new Map(),
      labelGroupIds: new Set(),
      projectIds: new Map(),
      milestoneIds: new Map(),
      milestoneProject: new Map(),
      cycleIds: new Map(),
      issueIds: new Map(),
      userIds: new Map(),
      warnings: [],
    };
    await this.loadUsers(ctx);
    await this.phaseTeams(ctx);
    await this.phaseStatuses(ctx);
    await this.phaseLabels(ctx);
    await this.phaseProjects(ctx);
    await this.phaseCycles(ctx);
    await this.reportProgress(run.id, PHASE.setup, null);
    if (!(await this.stillCommitting(run.id))) return false;

    if (!(await this.phaseIssues(ctx))) return false;
    await this.closeCycles(ctx);
    if (!(await this.phaseComments(ctx))) return false;
    if (!(await this.phaseParents(ctx))) return false;
    if (!(await this.phaseRelations(ctx))) return false;

    const result = await this.buildResult(ctx);
    const dry = (run.report ?? null) as ImportDryRunReport | null;
    const base: ImportDryRunReport = dry ?? { counts: this.emptyCounts(), unmapped: { users: [], statuses: [], teams: [] }, warnings: [] };
    const committed: ImportCommittedReport = {
      counts: {
        teamsToCreate: result.counts.teams,
        statusesToCreate: result.counts.statuses,
        labelsToCreate: result.counts.labels,
        projectsToCreate: result.counts.projects,
        cyclesToCreate: result.counts.cycles,
        issues: result.counts.issues,
        comments: result.counts.comments,
        relations: result.counts.relations,
        skippedIssues: ctx.plan.skipped,
      },
      unmapped: base.unmapped,
      warnings: [...base.warnings, ...result.warnings],
      dryRun: 'dryRun' in base ? (base as ImportCommittedReport).dryRun : base,
      result,
    };
    const flat = { ...result.counts };
    const finished = await this.tx(async (tx) => {
      const updated = await tx
        .update(importRuns)
        .set({ status: 'completed', progress: 1, committedCount: result.counts.issues, report: committed, error: null, updatedAt: this.now() })
        .where(and(eq(importRuns.id, run.id), eq(importRuns.status, 'committing')))
        .returning({ id: importRuns.id });
      if (!updated.length) return false;
      await publish(tx, 'import.progress', { runId: run.id, status: 'completed', progress: 1 });
      await publish(tx, 'import.completed', { runId: run.id, status: 'completed', counts: flat });
      await this.audit.log(tx, actor, { action: 'import.committed', objectType: 'import_run', objectId: run.id, changes: { source: run.source, counts: flat } });
      return true;
    });
    return finished;
  }

  private emptyCounts(): ImportDryRunReport['counts'] {
    return { teamsToCreate: 0, statusesToCreate: 0, labelsToCreate: 0, projectsToCreate: 0, cyclesToCreate: 0, issues: 0, comments: 0, relations: 0, skippedIssues: 0 };
  }

  private async buildResult(ctx: CommitCtx): Promise<ImportResult> {
    const rows = await this.db
      .select({ kind: importItems.kind, n: sql<number>`count(*)::int` })
      .from(importItems)
      .where(eq(importItems.runId, ctx.run.id))
      .groupBy(importItems.kind);
    const n = (k: string): number => rows.find((r) => r.kind === k)?.n ?? 0;
    return {
      counts: {
        teams: n('team'),
        statuses: n('status'),
        labels: n('label'),
        projects: n('project'),
        milestones: n('milestone'),
        cycles: n('cycle'),
        issues: n('issue'),
        comments: n('comment'),
        relations: n('relation'),
        parents: n('parent'),
        issuesFailed: ctx.plan.issues.length - n('issue'),
      },
      warnings: ctx.warnings,
    };
  }

  // ───────────── Phases ─────────────

  private async loadItems(runId: string, kind: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ externalId: importItems.externalId, entityId: importItems.entityId })
      .from(importItems)
      .where(and(eq(importItems.runId, runId), eq(importItems.kind, kind)));
    return new Map(rows.map((r) => [r.externalId, r.entityId]));
  }

  private async putItems(ex: DbOrTx, runId: string, kind: string, entries: [string, string][]): Promise<void> {
    if (!entries.length) return;
    await ex
      .insert(importItems)
      .values(entries.map(([externalId, entityId]) => ({ runId, kind, externalId, entityId })))
      .onConflictDoNothing();
  }

  private async stillCommitting(runId: string): Promise<boolean> {
    const [r] = await this.db.select({ status: importRuns.status }).from(importRuns).where(eq(importRuns.id, runId));
    return r?.status === 'committing';
  }

  private async reportProgress(runId: string, progress: number, committed: number | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(importRuns)
        .set({ progress, ...(committed !== null ? { committedCount: committed } : {}), updatedAt: this.now() })
        .where(and(eq(importRuns.id, runId), eq(importRuns.status, 'committing')));
      await publish(tx, 'import.progress', { runId, status: 'committing', progress });
    });
  }

  private async loadUsers(ctx: CommitCtx): Promise<void> {
    const ids = [...new Set(Object.values(ctx.mapping.users).filter((u): u is { userId: string } => u !== null).map((u) => u.userId))];
    if (!ids.length) return;
    const rows = await this.db.select().from(users).where(and(inArray(users.id, ids), isNull(users.deletedAt)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const [ext, m] of Object.entries(ctx.mapping.users)) {
      const row = m ? byId.get(m.userId) : undefined;
      if (row) ctx.userIds.set(ext, { id: row.id, assignable: !row.suspendedAt });
    }
  }

  private async phaseTeams(ctx: CommitCtx): Promise<void> {
    const items = await this.loadItems(ctx.run.id, 'team');
    for (const t of ctx.bundle.teams) {
      const m = ctx.mapping.teams[t.externalId];
      if (!m) continue;
      if (m.mode === 'existing') {
        await this.teamService.require(m.teamId);
        ctx.teamIds.set(t.externalId, m.teamId);
        continue;
      }
      const known = items.get(t.externalId);
      if (known) {
        ctx.teamIds.set(t.externalId, known);
        continue;
      }
      // Crash between creating the team and recording it? Adopt a team we created after this run began.
      const [orphan] = await this.db
        .select({ id: teams.id, createdAt: teams.createdAt })
        .from(teams)
        .where(and(eq(teams.key, m.key), isNull(teams.deletedAt)));
      let teamId: string;
      if (orphan && orphan.createdAt >= ctx.run.createdAt && !(await this.teamHasIssues(orphan.id))) {
        teamId = orphan.id;
      } else {
        teamId = (await this.teamService.create(ctx.actor, { key: m.key, name: m.name })).id;
      }
      await this.putItems(this.db, ctx.run.id, 'team', [[t.externalId, teamId]]);
      ctx.teamIds.set(t.externalId, teamId);
    }
  }

  private async teamHasIssues(teamId: string): Promise<boolean> {
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(issues).where(eq(issues.teamId, teamId));
    return (r?.n ?? 0) > 0;
  }

  private async phaseStatuses(ctx: CommitCtx): Promise<void> {
    const items = await this.loadItems(ctx.run.id, 'status');
    for (const s of ctx.bundle.statuses) {
      const key = statusKey(s.teamExternalId, s.name);
      const m = ctx.mapping.statuses[key];
      const teamId = ctx.teamIds.get(s.teamExternalId);
      if (!m || !teamId) continue;
      if (m.mode === 'existing') {
        ctx.statusIds.set(key, m.statusId);
        continue;
      }
      const known = items.get(key);
      if (known) {
        ctx.statusIds.set(key, known);
        continue;
      }
      const name = statusName(m.name);
      const found = await this.teamService.statusByName(teamId, name);
      if (found) {
        ctx.statusIds.set(key, found.id);
        continue;
      }
      const created = await this.tx(async (tx) => {
        const row = await this.teamService.createStatus(ctx.actor, teamId, { name, category: m.category, color: STATUS_COLORS[m.category] }, tx);
        await this.putItems(tx, ctx.run.id, 'status', [[key, row.id]]);
        return row;
      });
      ctx.statusIds.set(key, created.id);
    }
  }

  private async phaseLabels(ctx: CommitCtx): Promise<void> {
    const items = await this.loadItems(ctx.run.id, 'label');
    const existing = new Map((await this.db.select().from(labels)).map((l) => [lc(l.name), l]));
    await this.tx(async (tx) => {
      const fresh: [string, string][] = [];
      for (const l of ctx.plan.labels) {
        const known = items.get(l.key);
        const found = existing.get(l.key);
        if (known) {
          ctx.labelIds.set(l.key, known);
          if (l.isGroup) ctx.labelGroupIds.add(known);
          continue;
        }
        if (found) {
          ctx.labelIds.set(l.key, found.id);
          if (found.isGroup) ctx.labelGroupIds.add(found.id);
          continue;
        }
        const parent = l.group ? ctx.labelIds.get(lc(l.group)) : undefined;
        const [row] = await tx
          .insert(labels)
          .values({ name: l.name, color: 'grey', isGroup: l.isGroup, parentId: parent && ctx.labelGroupIds.has(parent) ? parent : null })
          .returning();
        if (!row) throw new Error('label insert failed');
        ctx.labelIds.set(l.key, row.id);
        if (l.isGroup) ctx.labelGroupIds.add(row.id);
        fresh.push([l.key, row.id]);
      }
      await this.putItems(tx, ctx.run.id, 'label', fresh);
    });
    // Existing labels that matched by name but live under a group we just created are left as they are.
  }

  private async phaseProjects(ctx: CommitCtx): Promise<void> {
    if (!ctx.plan.projects.length) return;
    const projectItems = await this.loadItems(ctx.run.id, 'project');
    const milestoneItems = await this.loadItems(ctx.run.id, 'milestone');
    for (const p of ctx.plan.projects) {
      const teamIdsForProject = [...new Set(ctx.plan.issues.filter((i) => i.projectExternalId === p.externalId).map((i) => ctx.teamIds.get(i.teamExternalId)).filter((x): x is string => Boolean(x)))];
      await this.tx(async (tx) => {
        let projectId = projectItems.get(p.externalId);
        if (!projectId) {
          const [byName] = await tx.select({ id: projects.id }).from(projects).where(and(isNull(projects.trashedAt), sql`lower(${projects.name}) = ${lc(p.name)}`));
          if (byName) projectId = byName.id;
          else {
            const [m] = await tx.select({ m: max(projects.sortOrder) }).from(projects);
            const lead = p.leadExternalId ? ctx.userIds.get(p.leadExternalId) : undefined;
            const [row] = await tx
              .insert(projects)
              .values({
                name: p.name.trim(),
                descriptionMd: sanitizeMarkdown(p.descriptionMd ?? ''),
                status: p.status ?? 'planned',
                leadId: lead?.id ?? null,
                targetDate: dateOnly(p.targetDate),
                createdBy: actorUserId(ctx.actor),
                sortOrder: (m?.m ?? 0) + 1000,
              })
              .returning();
            if (!row) throw new Error('project insert failed');
            projectId = row.id;
            await this.putItems(tx, ctx.run.id, 'project', [[p.externalId, projectId]]);
          }
        }
        if (teamIdsForProject.length) {
          await tx.insert(projectTeams).values(teamIdsForProject.map((teamId) => ({ projectId: projectId!, teamId }))).onConflictDoNothing();
        }
        ctx.projectIds.set(p.externalId, projectId);
        for (const ms of p.milestones) {
          let id = milestoneItems.get(ms.externalId);
          if (!id) {
            const [byName] = await tx.select({ id: milestones.id }).from(milestones).where(and(eq(milestones.projectId, projectId), sql`lower(${milestones.name}) = ${lc(ms.name)}`));
            if (byName) id = byName.id;
            else {
              const [m] = await tx.select({ m: max(milestones.sortOrder) }).from(milestones).where(eq(milestones.projectId, projectId));
              const [row] = await tx
                .insert(milestones)
                .values({ projectId, name: ms.name.trim().slice(0, 80), targetDate: dateOnly(ms.targetDate), sortOrder: (m?.m ?? 0) + 1000 })
                .returning();
              if (!row) throw new Error('milestone insert failed');
              id = row.id;
              await this.putItems(tx, ctx.run.id, 'milestone', [[ms.externalId, id]]);
            }
          }
          ctx.milestoneIds.set(ms.externalId, id);
          ctx.milestoneProject.set(ms.externalId, projectId);
        }
      });
    }
  }

  private async phaseCycles(ctx: CommitCtx): Promise<void> {
    if (!ctx.plan.cycles.length) return;
    const items = await this.loadItems(ctx.run.id, 'cycle');
    await this.tx(async (tx) => {
      const fresh: [string, string][] = [];
      for (const c of ctx.plan.cycles) {
        const teamId = ctx.teamIds.get(c.teamExternalId);
        if (!teamId) continue;
        const known = items.get(c.externalId);
        if (known) {
          ctx.cycleIds.set(c.externalId, known);
          continue;
        }
        const [found] = await tx.select({ id: cycles.id }).from(cycles).where(and(eq(cycles.teamId, teamId), eq(cycles.number, c.number)));
        if (found) {
          ctx.cycleIds.set(c.externalId, found.id);
          continue;
        }
        const [row] = await tx
          .insert(cycles)
          .values({ teamId, number: c.number, name: c.name?.trim() || null, startsAt: parseDate(c.startsAt)!, endsAt: parseDate(c.endsAt)! })
          .returning();
        if (!row) throw new Error('cycle insert failed');
        ctx.cycleIds.set(c.externalId, row.id);
        fresh.push([c.externalId, row.id]);
      }
      await this.putItems(tx, ctx.run.id, 'cycle', fresh);
    });
  }

  /** Cycles we created that ended in the past are closed (closedAt = endsAt) with a stats snapshot, after issues joined. */
  private async closeCycles(ctx: CommitCtx): Promise<void> {
    const created = await this.loadItems(ctx.run.id, 'cycle');
    const now = this.now();
    for (const c of ctx.plan.cycles) {
      const id = created.get(c.externalId);
      const endsAt = parseDate(c.endsAt);
      if (!id || !endsAt || endsAt > now) continue;
      const [agg] = await this.db
        .select({
          scope: sql<number>`count(*)::int`,
          points: sql<number>`coalesce(sum(${issues.estimate}), 0)::int`,
          done: sql<number>`count(*) filter (where ${issues.completedAt} is not null)::int`,
          donePoints: sql<number>`coalesce(sum(${issues.estimate}) filter (where ${issues.completedAt} is not null), 0)::int`,
          canceled: sql<number>`count(*) filter (where ${issues.canceledAt} is not null)::int`,
        })
        .from(issues)
        .where(eq(issues.cycleId, id));
      await this.db
        .update(cycles)
        .set({
          closedAt: endsAt,
          stats: {
            scopeCount: agg?.scope ?? 0,
            scopePoints: agg?.points ?? 0,
            completedCount: agg?.done ?? 0,
            completedPoints: agg?.donePoints ?? 0,
            canceledCount: agg?.canceled ?? 0,
            addedAfterStartCount: 0,
            removedCount: 0,
            carriedOverCount: 0,
          },
        })
        .where(and(eq(cycles.id, id), isNull(cycles.closedAt)));
    }
  }

  private async phaseIssues(ctx: CommitCtx): Promise<boolean> {
    const done = await this.loadItems(ctx.run.id, 'issue');
    for (const [k, v] of done) ctx.issueIds.set(k, v);
    const remaining = ctx.plan.issues.filter((i) => !done.has(i.externalId));
    const total = ctx.plan.issues.length;
    let processed = total - remaining.length;
    let chunks = 0;
    for (let off = 0; off < remaining.length; off += this.chunkSize) {
      if (!(await this.stillCommitting(ctx.run.id))) return false;
      const chunk = remaining.slice(off, off + this.chunkSize);
      const created: [string, string][] = [];
      const warns: ImportWarning[] = [];
      await this.tx(async (tx) => {
        for (const issue of chunk) {
          const teamId = ctx.teamIds.get(issue.teamExternalId);
          if (!teamId) continue;
          const input = this.issueInput(ctx, issue, teamId);
          try {
            const row = await tx.transaction(async (sp) => {
              const r = await this.issueService.createInTx(sp, ctx.actor, input);
              const updatedAt = parseDate(issue.updatedAt);
              if (updatedAt) await sp.update(issues).set({ updatedAt }).where(eq(issues.id, r.id));
              return r;
            });
            created.push([issue.externalId, row.id]);
          } catch (err) {
            if (err instanceof ServiceError && (err.code === 'VALIDATION' || err.code === 'NOT_FOUND' || err.code === 'CONFLICT')) {
              warns.push({ code: 'issue_failed', message: `Issue ${issue.externalId} could not be imported: ${err.message}`, externalId: issue.externalId });
            } else throw err;
          }
        }
        await this.putItems(tx, ctx.run.id, 'issue', created);
        processed += chunk.length;
        const progress = PHASE.setup + (PHASE.issues - PHASE.setup) * (processed / Math.max(total, 1));
        await tx
          .update(importRuns)
          .set({ progress, committedCount: done.size + created.length, updatedAt: this.now() })
          .where(eq(importRuns.id, ctx.run.id));
        await publish(tx, 'import.progress', { runId: ctx.run.id, status: 'committing', progress });
      });
      for (const [k, v] of created) {
        ctx.issueIds.set(k, v);
        done.set(k, v);
      }
      ctx.warnings.push(...warns);
      chunks++;
      if (this.failAfterChunks !== null && chunks >= this.failAfterChunks) {
        throw new Error(`Injected failure after ${chunks} chunk(s)`);
      }
    }
    return true;
  }

  private issueInput(ctx: CommitCtx, issue: ImportIssue, teamId: string) {
    const statusId = ctx.statusIds.get(statusKey(issue.teamExternalId, issue.statusName)) ?? null;
    const assignee = issue.assigneeExternalId ? ctx.userIds.get(issue.assigneeExternalId) : undefined;
    const creator = issue.creatorExternalId ? ctx.userIds.get(issue.creatorExternalId) : undefined;
    const labelIds = [
      ...new Set(
        issue.labelNames
          .map((n) => ctx.labelIds.get(lc(labelName(n))))
          .filter((x): x is string => Boolean(x) && !ctx.labelGroupIds.has(x as string)),
      ),
    ].slice(0, MAX_LABELS_PER_ISSUE);
    let projectId = issue.projectExternalId ? (ctx.projectIds.get(issue.projectExternalId) ?? null) : null;
    let milestoneId = issue.milestoneExternalId ? (ctx.milestoneIds.get(issue.milestoneExternalId) ?? null) : null;
    if (milestoneId) {
      const owner = ctx.milestoneProject.get(issue.milestoneExternalId ?? '');
      if (projectId && owner !== projectId) milestoneId = null;
      else if (!projectId) projectId = owner ?? null;
    }
    return {
      teamId,
      title: issue.title,
      descriptionMd: issue.descriptionMd ?? '',
      statusId,
      assigneeId: assignee?.assignable ? assignee.id : null,
      priority: issue.priority ?? 4, // missing priority = "No priority" (4), never Urgent (0)
      estimate: issue.estimate ?? null,
      labelIds,
      projectId,
      milestoneId,
      cycleId: issue.cycleExternalId ? (ctx.cycleIds.get(issue.cycleExternalId) ?? null) : null,
      createdAt: parseDate(issue.createdAt),
      completedAt: parseDate(issue.completedAt),
      canceledAt: parseDate(issue.canceledAt),
      archivedAt: parseDate(issue.archivedAt),
      createdBy: creator?.id ?? null,
    };
  }

  private async phaseComments(ctx: CommitCtx): Promise<boolean> {
    const done = await this.loadItems(ctx.run.id, 'comment');
    const issueByExt = new Map(ctx.plan.issues.map((i) => [i.externalId, i]));
    const userName = new Map(ctx.bundle.users.map((u) => [u.externalId, u.name]));
    const remaining = ctx.plan.comments.filter((c) => !done.has(c.key) && ctx.issueIds.has(c.issueExt));
    const total = ctx.plan.comments.length;
    let processed = total - remaining.length;
    for (let off = 0; off < remaining.length; off += this.chunkSize) {
      if (!(await this.stillCommitting(ctx.run.id))) return false;
      const chunk = remaining.slice(off, off + this.chunkSize);
      await this.tx(async (tx) => {
        const rows = await tx
          .insert(comments)
          .values(
            chunk.map((c) => {
              const author = c.comment.authorExternalId ? ctx.userIds.get(c.comment.authorExternalId) : undefined;
              const created = parseDate(c.comment.createdAt) ?? parseDate(issueByExt.get(c.issueExt)?.createdAt) ?? this.now();
              return {
                issueId: ctx.issueIds.get(c.issueExt)!,
                authorId: author?.id ?? null,
                authorName: author ? null : (c.comment.authorName?.trim() || (c.comment.authorExternalId ? userName.get(c.comment.authorExternalId) : undefined) || 'Unknown author'),
                source: 'import' as const,
                bodyMd: sanitizeMarkdown(c.comment.bodyMd).trim().slice(0, 65536) || '(empty)',
                createdAt: created,
              };
            }),
          )
          .returning({ id: comments.id });
        if (rows.length !== chunk.length) throw new Error('comment insert returned an unexpected row count');
        await this.putItems(tx, ctx.run.id, 'comment', chunk.map((c, i): [string, string] => [c.key, rows[i]!.id]));
        processed += chunk.length;
        const progress = PHASE.issues + (PHASE.comments - PHASE.issues) * (processed / Math.max(total, 1));
        await tx.update(importRuns).set({ progress, updatedAt: this.now() }).where(eq(importRuns.id, ctx.run.id));
        await publish(tx, 'import.progress', { runId: ctx.run.id, status: 'committing', progress });
      });
    }
    await this.reportProgress(ctx.run.id, PHASE.comments, null);
    return true;
  }

  private async phaseParents(ctx: CommitCtx): Promise<boolean> {
    const done = await this.loadItems(ctx.run.id, 'parent');
    const remaining = ctx.plan.parents.filter((p) => !done.has(p.child) && ctx.issueIds.has(p.child) && ctx.issueIds.has(p.parent));
    for (let off = 0; off < remaining.length; off += this.chunkSize) {
      if (!(await this.stillCommitting(ctx.run.id))) return false;
      const chunk = remaining.slice(off, off + this.chunkSize);
      await this.tx(async (tx) => {
        for (const p of chunk) {
          await tx.update(issues).set({ parentId: ctx.issueIds.get(p.parent)! }).where(eq(issues.id, ctx.issueIds.get(p.child)!));
        }
        await this.putItems(tx, ctx.run.id, 'parent', chunk.map((p): [string, string] => [p.child, ctx.issueIds.get(p.parent)!]));
      });
    }
    await this.reportProgress(ctx.run.id, PHASE.parents, null);
    return true;
  }

  private async phaseRelations(ctx: CommitCtx): Promise<boolean> {
    const done = await this.loadItems(ctx.run.id, 'relation');
    const remaining = ctx.plan.relations.filter((r) => !done.has(r.key) && ctx.issueIds.has(r.src) && ctx.issueIds.has(r.tgt));
    for (let off = 0; off < remaining.length; off += this.chunkSize) {
      if (!(await this.stillCommitting(ctx.run.id))) return false;
      const chunk = remaining.slice(off, off + this.chunkSize);
      await this.tx(async (tx) => {
        const fresh: [string, string][] = [];
        for (const r of chunk) {
          try {
            const row = await tx.transaction((sp) =>
              this.issueService.addRelationInTx(sp, ctx.actor, ctx.issueIds.get(r.src)!, r.type, ctx.issueIds.get(r.tgt)!),
            );
            fresh.push([r.key, row.id]);
          } catch (err) {
            // Already related (e.g. an existing mirrored link): ignore.
            if (!(err instanceof ServiceError && (err.code === 'CONFLICT' || err.code === 'VALIDATION'))) throw err;
          }
        }
        await this.putItems(tx, ctx.run.id, 'relation', fresh);
      });
    }
    return true;
  }

  // ───────────── Cancel / reads ─────────────

  async cancel(actor: ServiceActor, id: string): Promise<ImportRunRow> {
    assertCan(actor, 'workspace.import_export');
    const run = await this.requireRun(id);
    if (run.status === 'completed' || run.status === 'canceled') throw validation(`This import is already ${run.status}.`);
    const [row] = await this.db
      .update(importRuns)
      .set({ status: 'canceled', updatedAt: this.now() })
      .where(and(eq(importRuns.id, id), inArray(importRuns.status, ['mapping', 'ready', 'committing', 'failed'])))
      .returning(SLIM);
    if (!row) throw validation('This import can no longer be canceled.');
    return row;
  }

  async get(actor: ServiceActor, id: string): Promise<ImportRunRow | null> {
    assertCan(actor, 'workspace.import_export');
    const [row] = await this.db.select(SLIM).from(importRuns).where(eq(importRuns.id, id));
    return row ?? null;
  }

  async list(actor: ServiceActor): Promise<ImportRunRow[]> {
    assertCan(actor, 'workspace.import_export');
    return this.db.select(SLIM).from(importRuns).orderBy(desc(importRuns.createdAt), desc(importRuns.id)).limit(50);
  }

  // ───────────── Internals ─────────────

  private async requireRun(id: string): Promise<ImportRunRow> {
    if (!UUID_LOOSE.test(id)) throw notFound('Import run');
    const [row] = await this.db.select(SLIM).from(importRuns).where(eq(importRuns.id, id));
    if (!row) throw notFound('Import run');
    return row;
  }

  private async loadBundle(id: string): Promise<ImportBundle> {
    const [row] = await this.db.select({ config: importRuns.config }).from(importRuns).where(eq(importRuns.id, id));
    if (!row) throw notFound('Import run');
    return row.config as ImportBundle;
  }

  private mappingOf(run: ImportRunRow): ImportMapping {
    if (!run.mapping) throw validation('This import has no mapping.');
    return run.mapping as ImportMapping;
  }
}
