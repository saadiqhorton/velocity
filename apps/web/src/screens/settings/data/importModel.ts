/** Typed views over the JSON the import API returns (mapping, summary, report). Pure and unit-testable. */

export type StatusCategory = 'backlog' | 'todo' | 'in_progress' | 'done' | 'canceled';
export const STATUS_CATEGORIES: StatusCategory[] = ['backlog', 'todo', 'in_progress', 'done', 'canceled'];

export type TeamTarget = { mode: 'existing'; teamId: string } | { mode: 'create'; key: string; name: string };
export type StatusTarget = { mode: 'existing'; statusId: string } | { mode: 'create'; name: string; category: StatusCategory };
export type UserTarget = { userId: string } | null;

export interface ImportInclude {
  projects: boolean;
  cycles: boolean;
  comments: boolean;
  relations: boolean;
  archived: boolean;
}

export interface ImportMappingModel {
  teams: Record<string, TeamTarget>;
  statuses: Record<string, StatusTarget>;
  users: Record<string, UserTarget>;
  include: ImportInclude;
}

export interface ImportSummary {
  teams: { externalId: string; key: string; name: string }[];
  statuses: { teamExternalId: string; name: string; category: string | null }[];
  users: { externalId: string; name: string; email?: string | null }[];
  counts: { issues: number; labels: number; projects: number; cycles: number };
  warnings: { code: string; message: string; externalId?: string }[];
}

export interface ReportWarning {
  code: string;
  message: string;
  externalId?: string;
}

export interface DryRunCounts {
  teamsToCreate: number;
  statusesToCreate: number;
  labelsToCreate: number;
  projectsToCreate: number;
  cyclesToCreate: number;
  issues: number;
  comments: number;
  relations: number;
  skippedIssues: number;
}

export interface ImportReportModel {
  counts: DryRunCounts;
  unmapped: { users: string[]; statuses: string[]; teams: string[] };
  warnings: ReportWarning[];
  /** Present once the run has committed. */
  result: { counts: Record<string, number>; warnings: ReportWarning[] } | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const DEFAULT_INCLUDE: ImportInclude = { projects: true, cycles: true, comments: true, relations: true, archived: false };

export function parseMapping(raw: unknown): ImportMappingModel | null {
  if (!isRecord(raw) || !isRecord(raw.teams)) return null;
  const include = isRecord(raw.include) ? { ...DEFAULT_INCLUDE, ...(raw.include as Partial<ImportInclude>) } : DEFAULT_INCLUDE;
  return {
    teams: raw.teams as Record<string, TeamTarget>,
    statuses: (isRecord(raw.statuses) ? raw.statuses : {}) as Record<string, StatusTarget>,
    users: (isRecord(raw.users) ? raw.users : {}) as Record<string, UserTarget>,
    include,
  };
}

const EMPTY_SUMMARY: ImportSummary = { teams: [], statuses: [], users: [], counts: { issues: 0, labels: 0, projects: 0, cycles: 0 }, warnings: [] };

export function parseSummary(raw: unknown): ImportSummary {
  if (!isRecord(raw)) return EMPTY_SUMMARY;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const counts = isRecord(raw.counts) ? (raw.counts as Partial<ImportSummary['counts']>) : {};
  return {
    teams: arr(raw.teams),
    statuses: arr(raw.statuses),
    users: arr(raw.users),
    counts: { issues: counts.issues ?? 0, labels: counts.labels ?? 0, projects: counts.projects ?? 0, cycles: counts.cycles ?? 0 },
    warnings: arr(raw.warnings),
  };
}

export function parseReport(raw: unknown): ImportReportModel | null {
  if (!isRecord(raw) || !isRecord(raw.counts)) return null;
  const unmapped = isRecord(raw.unmapped) ? raw.unmapped : {};
  const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  const result = isRecord(raw.result)
    ? {
        counts: (isRecord(raw.result.counts) ? raw.result.counts : {}) as Record<string, number>,
        warnings: (Array.isArray(raw.result.warnings) ? raw.result.warnings : []) as ReportWarning[],
      }
    : null;
  return {
    counts: raw.counts as unknown as DryRunCounts,
    unmapped: { users: list(unmapped.users), statuses: list(unmapped.statuses), teams: list(unmapped.teams) },
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : []) as ReportWarning[],
    result,
  };
}

/** `${teamExternalId}::${statusName}` (the server splits at the first `::`). */
export function splitStatusKey(key: string): { teamExternalId: string; name: string } {
  const i = key.indexOf('::');
  return i < 0 ? { teamExternalId: '', name: key } : { teamExternalId: key.slice(0, i), name: key.slice(i + 2) };
}

export interface TargetTeam {
  id: string;
  statuses: { id: string; name: string; category: string }[];
}

function asCategory(c: string | null | undefined): StatusCategory {
  return (STATUS_CATEGORIES as string[]).includes(c ?? '') ? (c as StatusCategory) : 'todo';
}

/**
 * Point a source team at a new target and re-derive its statuses so the mapping stays valid:
 * an existing status must belong to the mapped team, a new team can only create statuses.
 */
export function retargetTeam(
  mapping: ImportMappingModel,
  teamExternalId: string,
  target: TeamTarget,
  targetTeam: TargetTeam | null,
  sourceCategories: Map<string, string | null>,
): ImportMappingModel {
  const statuses: Record<string, StatusTarget> = { ...mapping.statuses };
  for (const [key, current] of Object.entries(mapping.statuses)) {
    const { teamExternalId: ext, name } = splitStatusKey(key);
    if (ext !== teamExternalId) continue;
    const found = target.mode === 'existing' ? targetTeam?.statuses.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase()) : undefined;
    if (found) statuses[key] = { mode: 'existing', statusId: found.id };
    else {
      const category = current.mode === 'create' ? current.category : asCategory(sourceCategories.get(key));
      statuses[key] = { mode: 'create', name, category };
    }
  }
  return { ...mapping, teams: { ...mapping.teams, [teamExternalId]: target }, statuses };
}

/** Members the mapping leaves unresolved (comments and assignees fall back to the importing user). */
export function unmappedUsers(mapping: ImportMappingModel): string[] {
  return Object.entries(mapping.users)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
}

/** Unfinished runs can be resumed from the run list. */
export function isUnfinished(status: string): boolean {
  return status === 'mapping' || status === 'ready' || status === 'committing' || status === 'failed';
}

export function stepOf(status: string): 2 | 3 | 4 {
  if (status === 'mapping') return 2;
  if (status === 'ready') return 3;
  return 4;
}
