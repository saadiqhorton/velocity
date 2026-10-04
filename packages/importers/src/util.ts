import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import type {
  ImportBundle,
  ImportCycle,
  ImportIssue,
  ImportLabel,
  ImportProject,
  ImportStatus,
  ImportTeam,
  ImportUser,
  ImportWarning,
  ImportSource,
} from '@velocity/schema';

export type CsvInput = string | NodeJS.ReadableStream;

export const MAX_ESTIMATE = 40;
export const MAX_LABELS_PER_ISSUE = 10;

/** Stream CSV records as string arrays (no header handling). Works for strings and Node streams. */
export async function* readCsvRows(input: CsvInput): AsyncGenerator<string[]> {
  const parser = parse({
    columns: false,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    bom: true,
  });
  const source: NodeJS.ReadableStream = typeof input === 'string' ? Readable.from([input]) : input;
  source.on('error', (e: Error) => parser.destroy(e));
  source.pipe(parser);
  for await (const record of parser) yield record as string[];
}

/** Parse a date in ISO or JS-Date style (optionally with a trailing "(Zone name)") into an ISO string. */
export function parseDate(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  const t = Date.parse(s.replace(/\s*\([^)]*\)\s*$/, ''));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Uppercase alphanumeric key, starting with a letter, max 10 chars. Empty string when nothing usable. */
export function sanitizeKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, 10);
}

/** Round and clamp an estimate to 0..40. Returns the value and whether it was clamped. */
export function normalizeEstimate(n: number): { value: number; clamped: boolean } {
  const r = Math.round(n);
  const v = Math.min(MAX_ESTIMATE, Math.max(0, r));
  return { value: v, clamped: v !== r };
}

export function splitList(raw: string | undefined, sep = ','): string[] {
  if (!raw) return [];
  return raw
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Accumulates bundle entities with de-duplication. */
export class Collector {
  teams = new Map<string, ImportTeam>();
  statuses = new Map<string, ImportStatus>();
  users = new Map<string, ImportUser>();
  labels = new Map<string, ImportLabel>();
  projects = new Map<string, ImportProject>();
  cycles = new Map<string, ImportCycle>();
  issues: ImportIssue[] = [];
  warnings: ImportWarning[] = [];

  warn(code: string, message: string, externalId?: string): void {
    this.warnings.push(externalId ? { code, message, externalId } : { code, message });
  }

  addLabel(name: string, group?: string | null): void {
    if (!this.labels.has(name)) this.labels.set(name, { name, group: group ?? null });
  }

  addStatus(s: ImportStatus): void {
    const k = `${s.teamExternalId}::${s.name}`;
    if (!this.statuses.has(k)) this.statuses.set(k, s);
  }

  addUser(u: ImportUser): void {
    const existing = this.users.get(u.externalId);
    if (!existing) this.users.set(u.externalId, u);
    else {
      if (!existing.email && u.email) existing.email = u.email;
      if (!existing.username && u.username) existing.username = u.username;
    }
  }

  toBundle(source: ImportSource): ImportBundle {
    return {
      source,
      teams: [...this.teams.values()],
      statuses: [...this.statuses.values()],
      users: [...this.users.values()],
      labels: [...this.labels.values()],
      projects: [...this.projects.values()],
      cycles: [...this.cycles.values()],
      issues: this.issues,
      warnings: this.warnings,
    };
  }
}

/** Collects relations first and applies them once every issue is known; dedupes symmetric/duplicate edges. */
export class RelationResolver {
  private pending: { from: string; type: 'blocks' | 'related' | 'duplicate'; to: string; owner: string }[] = [];
  /** `owner` is the issue whose row declared the relation (used for warnings). */
  add(from: string, type: 'blocks' | 'related' | 'duplicate', to: string, owner: string = from): void {
    this.pending.push({ from, type, to, owner });
  }
  apply(issues: ImportIssue[], c: Collector): void {
    const byId = new Map(issues.map((i) => [i.externalId, i]));
    const seen = new Set<string>();
    for (const r of this.pending) {
      const src = byId.get(r.from);
      if (r.from === r.to) continue;
      if (!src || !byId.has(r.to)) {
        const missing = src ? r.to : r.from;
        c.warn('unknown_relation_target', `Related issue ${missing} is not part of this import`, r.owner);
        continue;
      }
      const key = r.type === 'related' ? `related|${[r.from, r.to].sort().join('|')}` : `${r.type}|${r.from}|${r.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      src.relations.push({ type: r.type, targetExternalId: r.to });
    }
  }
}

export function emptyBundle(source: ImportSource, warnings: ImportWarning[] = []): ImportBundle {
  return { source, teams: [], statuses: [], users: [], labels: [], projects: [], cycles: [], issues: [], warnings };
}

export function capLabels(names: string[], c: Collector, externalId: string): string[] {
  const uniq = [...new Set(names)];
  if (uniq.length > MAX_LABELS_PER_ISSUE) {
    c.warn('too_many_labels', `Issue has ${uniq.length} labels; only the first ${MAX_LABELS_PER_ISSUE} are kept`, externalId);
    return uniq.slice(0, MAX_LABELS_PER_ISSUE);
  }
  return uniq;
}
