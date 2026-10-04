import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import type { ImportBundle, ImportDryRunReport, ImportMapping, ImportSource } from '@velocity/schema';
import {
  COMMIT_IMPORT,
  CREATE_IMPORT_RUN,
  DRY_RUN_IMPORT,
  GraphQLRequestError,
  IMPORT_RUN,
  createClient,
  type ImportRunStatus,
  type VelocityClient,
} from './client';
import { fetchGithubIssues } from './github';
import { parseJiraCsv } from './jira-csv';
import { fetchLinearApi } from './linear-api';
import { parseLinearCsv } from './linear-csv';

export const IMPORT_KINDS = ['linear-csv', 'jira-csv', 'linear-api', 'github'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface ImportFlowOptions {
  kind: ImportKind;
  file?: string;
  url: string;
  apiKey: string;
  linearKey?: string;
  githubToken?: string;
  repos?: string[];
  dryRun?: boolean;
  yes?: boolean;
}

export interface ImportFlowDeps {
  fetch?: typeof fetch;
  print: (line: string) => void;
  /** Write without newline (progress bar). */
  write: (text: string) => void;
  confirm: (question: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  /** Override bundle building (tests). */
  buildBundle?: (opts: ImportFlowOptions) => Promise<ImportBundle>;
  stdin?: NodeJS.ReadableStream;
}

export function sourceOf(kind: ImportKind): ImportSource {
  return kind === 'jira-csv' ? 'jira' : kind === 'github' ? 'github' : 'linear';
}

export async function buildBundle(opts: ImportFlowOptions, deps?: Pick<ImportFlowDeps, 'stdin' | 'fetch'>): Promise<ImportBundle> {
  switch (opts.kind) {
    case 'linear-csv':
    case 'jira-csv': {
      const input = opts.file ? createReadStream(opts.file) : deps?.stdin;
      if (!input) throw new Error(`${opts.kind} needs a CSV file argument (or data on stdin)`);
      return opts.kind === 'linear-csv' ? parseLinearCsv(input) : parseJiraCsv(input);
    }
    case 'linear-api':
      if (!opts.linearKey) throw new Error('linear-api needs --linear-key (or LINEAR_API_KEY)');
      return fetchLinearApi({ apiKey: opts.linearKey, fetch: deps?.fetch });
    case 'github':
      if (!opts.githubToken) throw new Error('github needs --github-token (or GITHUB_TOKEN)');
      if (!opts.repos?.length) throw new Error('github needs --repos owner/a,owner/b');
      return fetchGithubIssues({ token: opts.githubToken, repos: opts.repos, fetch: deps?.fetch });
  }
}

export function renderBar(progress: number, width = 30): string {
  const p = Math.max(0, Math.min(1, progress));
  const filled = Math.round(p * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${String(Math.round(p * 100)).padStart(3)}%`;
}

interface RunInfo {
  id: string;
  status: ImportRunStatus;
  progress?: number | null;
  report?: ImportDryRunReport | null;
  error?: string | null;
}

function printMapping(bundle: ImportBundle, mapping: ImportMapping, print: (l: string) => void): void {
  print('\nSuggested mapping');
  print('  Teams:');
  for (const t of bundle.teams) {
    const m = mapping.teams[t.externalId];
    print(
      m?.mode === 'existing'
        ? `    ${t.name} (${t.key}) -> existing team`
        : `    ${t.name} (${t.key}) -> create team ${m?.mode === 'create' ? m.key : '?'}`,
    );
  }
  print('  Statuses:');
  for (const s of bundle.statuses) {
    const m = mapping.statuses[`${s.teamExternalId}::${s.name}`];
    if (m?.mode === 'existing') print(`    ${s.name} -> existing status`);
    else if (s.category === null) print(`    ! ${s.name} -> create as "${m?.mode === 'create' ? m.category : 'todo'}" (UNMAPPED: category could not be inferred)`);
    else print(`    ${s.name} -> create as "${s.category}"`);
  }
  const unmatched = bundle.users.filter((u) => !mapping.users[u.externalId]);
  print(`  Users: ${bundle.users.length - unmatched.length} matched, ${unmatched.length} unmatched`);
  for (const u of unmatched.slice(0, 20)) print(`    ! ${u.name}${u.email ? ` <${u.email}>` : ''} -> unassigned`);
  if (unmatched.length > 20) print(`    ... and ${unmatched.length - 20} more`);
}

function printReport(r: ImportDryRunReport, print: (l: string) => void): void {
  const c = r.counts;
  print('\nDry-run report');
  print(`  Issues: ${c.issues} (skipped: ${c.skippedIssues})`);
  print(`  Comments: ${c.comments}   Relations: ${c.relations}`);
  print(`  To create: ${c.teamsToCreate} teams, ${c.statusesToCreate} statuses, ${c.labelsToCreate} labels, ${c.projectsToCreate} projects, ${c.cyclesToCreate} cycles`);
  const u = r.unmapped;
  if (u.users.length) print(`  Unmapped users: ${u.users.join(', ')}`);
  if (u.statuses.length) print(`  Unmapped statuses: ${u.statuses.join(', ')}`);
  if (u.teams.length) print(`  Unmapped teams: ${u.teams.join(', ')}`);
  if (r.warnings.length) {
    print(`  Warnings (${r.warnings.length}):`);
    for (const w of r.warnings.slice(0, 10)) print(`    - ${w.message}${w.externalId ? ` [${w.externalId}]` : ''}`);
    if (r.warnings.length > 10) print(`    ... and ${r.warnings.length - 10} more`);
  }
}

/** Runs the whole CLI flow; returns the process exit code. */
export async function runImport(opts: ImportFlowOptions, deps: ImportFlowDeps, client?: VelocityClient): Promise<number> {
  const api = client ?? createClient({ url: opts.url, apiKey: opts.apiKey, fetch: deps.fetch });
  try {
    deps.print('Reading source data...');
    const bundle = await (deps.buildBundle ?? ((o) => buildBundle(o, deps)))(opts);
    deps.print(
      `Parsed ${bundle.issues.length} issues, ${bundle.teams.length} teams, ${bundle.users.length} users, ${bundle.labels.length} labels, ${bundle.projects.length} projects, ${bundle.cycles.length} cycles.`,
    );
    if (bundle.warnings.length) {
      deps.print(`${bundle.warnings.length} parse warning(s):`);
      for (const w of bundle.warnings.slice(0, 5)) deps.print(`  - ${w.message}`);
      if (bundle.warnings.length > 5) deps.print(`  ... and ${bundle.warnings.length - 5} more`);
    }
    if (bundle.issues.length === 0) {
      deps.print('Nothing to import.');
      return 1;
    }

    const created = await api.request<{ createImportRun: { id: string; status: string; suggestedMapping: ImportMapping } }>(
      CREATE_IMPORT_RUN,
      { input: { source: sourceOf(opts.kind), bundle, fileName: opts.file ? basename(opts.file) : null } },
    );
    const run = created.createImportRun;
    printMapping(bundle, run.suggestedMapping, deps.print);

    const dry = await api.request<{ dryRunImport: RunInfo }>(DRY_RUN_IMPORT, { id: run.id });
    if (dry.dryRunImport.report) printReport(dry.dryRunImport.report, deps.print);
    if (opts.dryRun) {
      deps.print('\nDry run only; nothing was imported.');
      return 0;
    }
    if (!opts.yes && !(await deps.confirm('\nCommit this import? [y/N] '))) {
      deps.print('Aborted. Nothing was imported.');
      return 1;
    }

    const commit = await api.request<{ commitImport: RunInfo }>(COMMIT_IMPORT, { id: run.id });
    let info: RunInfo = commit.commitImport;
    for (;;) {
      deps.write(`\r${renderBar(info.progress ?? 0)} ${info.status}`);
      if (info.status === 'completed' || info.status === 'failed' || info.status === 'canceled') break;
      await deps.sleep(1000);
      info = (await api.request<{ importRun: RunInfo }>(IMPORT_RUN, { id: run.id })).importRun;
    }
    deps.write('\n');
    if (info.status === 'completed') {
      deps.print('Import completed.');
      return 0;
    }
    deps.print(`Import ${info.status}${info.error ? `: ${info.error}` : ''}`);
    return 1;
  } catch (e) {
    deps.print(e instanceof GraphQLRequestError || e instanceof Error ? `Error: ${e.message}` : 'Error: unknown failure');
    return 1;
  }
}
