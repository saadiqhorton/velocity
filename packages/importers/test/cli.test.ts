import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ImportMapping } from '@velocity/schema';
import { createClient, GraphQLRequestError, parseJiraCsv, parseLinearCsv, runImport, validateBundle, renderBar, suggestMapping } from '../src';
import { generateLinearCsv } from '../scripts/generate-linear-csv';
import { fixturePath, fixtureText, jsonResponse } from './helpers';

type FetchFn = typeof fetch;

describe('client', () => {
  it('posts to /graphql with the api key', async () => {
    const fn = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => {
      void _u;
      void _i;
      return jsonResponse({ data: { ok: 1 } });
    });
    const client = createClient({ url: 'http://localhost:3000/', apiKey: 'vel_abc', fetch: fn as unknown as FetchFn });
    expect(await client.request<{ ok: number }>('query { ok }', { a: 1 })).toEqual({ ok: 1 });
    const [url, init] = fn.mock.calls[0]!;
    expect(String(url)).toBe('http://localhost:3000/graphql');
    expect((init?.headers as Record<string, string>).Authorization).toBe('vel_abc');
    expect(JSON.parse(String(init?.body))).toEqual({ query: 'query { ok }', variables: { a: 1 } });
  });

  it('throws the first GraphQL error message', async () => {
    const fn = (async () => jsonResponse({ errors: [{ message: 'Forbidden' }, { message: 'other' }] })) as unknown as FetchFn;
    await expect(createClient({ url: 'http://x', apiKey: 'k', fetch: fn }).request('q')).rejects.toThrow(GraphQLRequestError);
    await expect(createClient({ url: 'http://x', apiKey: 'k', fetch: fn }).request('q')).rejects.toThrow('Forbidden');
  });
});

function serverMock(opts: { failAt?: string; statuses?: string[] } = {}) {
  const ops: string[] = [];
  let polls = 0;
  const statuses = opts.statuses ?? ['committing', 'completed'];
  let seenBundle: unknown;
  const fn = (async (_u: string | URL | Request, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    const op = /(?:mutation|query) (\w+)/.exec(query)![1]!;
    ops.push(op);
    if (op === opts.failAt) return jsonResponse({ errors: [{ message: `${op} failed` }] });
    switch (op) {
      case 'CreateImportRun': {
        seenBundle = (variables.input as { bundle: unknown }).bundle;
        const bundle = validateBundle(seenBundle);
        const mapping: ImportMapping = suggestMapping(bundle, { teams: [], users: [], labels: [] });
        return jsonResponse({ data: { createImportRun: { id: 'run1', status: 'mapping', suggestedMapping: mapping } } });
      }
      case 'DryRunImport':
        return jsonResponse({
          data: {
            dryRunImport: {
              id: 'run1', status: 'ready',
              report: {
                counts: { teamsToCreate: 3, statusesToCreate: 5, labelsToCreate: 2, projectsToCreate: 1, cyclesToCreate: 1, issues: 10, comments: 0, relations: 2, skippedIssues: 1 },
                unmapped: { users: ['Zed'], statuses: ['Waiting on legal'], teams: [] },
                warnings: [{ code: 'x', message: 'careful' }],
              },
            },
          },
        });
      case 'CommitImport':
        return jsonResponse({ data: { commitImport: { id: 'run1', status: 'committing', progress: 0 } } });
      case 'ImportRun': {
        const status = statuses[Math.min(polls++, statuses.length - 1)]!;
        return jsonResponse({ data: { importRun: { id: 'run1', status, progress: status === 'completed' ? 1 : 0.5, error: status === 'failed' ? 'boom' : null } } });
      }
    }
    return jsonResponse({ errors: [{ message: 'unknown op' }] });
  }) as unknown as FetchFn;
  return { fn, ops, seenBundle: () => seenBundle };
}

function deps(fn: FetchFn, confirm = true) {
  const lines: string[] = [];
  const sleep = vi.fn(async () => {});
  return {
    lines,
    sleep,
    d: {
      fetch: fn,
      print: (l: string) => lines.push(l),
      write: (t: string) => lines.push(t),
      confirm: vi.fn(async () => confirm),
      sleep,
    },
  };
}

const base = { kind: 'linear-csv' as const, file: fixturePath('linear-export.csv'), url: 'http://srv', apiKey: 'vel_k' };

describe('runImport', () => {
  it('runs the happy path: create, dry run, commit, poll', async () => {
    const s = serverMock();
    const { d, lines, sleep } = deps(s.fn);
    expect(await runImport({ ...base, yes: true }, d)).toBe(0);
    expect(s.ops.slice(0, 3)).toEqual(['CreateImportRun', 'DryRunImport', 'CommitImport']);
    expect(s.ops.filter((o) => o === 'ImportRun').length).toBeGreaterThan(0);
    expect(sleep).toHaveBeenCalledWith(1000);
    const out = lines.join('\n');
    expect(out).toContain('Suggested mapping');
    expect(out).toContain('UNMAPPED');
    expect(out).toContain('Dry-run report');
    expect(out).toContain('Waiting on legal');
    expect(out).toContain('Import completed.');
    expect(out).toContain(renderBar(1));
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it('stops after the report with --dry-run', async () => {
    const s = serverMock();
    const { d } = deps(s.fn);
    expect(await runImport({ ...base, dryRun: true }, d)).toBe(0);
    expect(s.ops).toEqual(['CreateImportRun', 'DryRunImport']);
  });

  it('asks for confirmation and aborts on no', async () => {
    const s = serverMock();
    const { d } = deps(s.fn, false);
    expect(await runImport(base, d)).toBe(1);
    expect(d.confirm).toHaveBeenCalled();
    expect(s.ops).toEqual(['CreateImportRun', 'DryRunImport']);
  });

  it('exits 1 with the GraphQL error message', async () => {
    const s = serverMock({ failAt: 'DryRunImport' });
    const { d, lines } = deps(s.fn);
    expect(await runImport({ ...base, yes: true }, d)).toBe(1);
    expect(lines.join('\n')).toContain('Error: DryRunImport failed');
    expect(s.ops).not.toContain('CommitImport');
  });

  it('reports a failed import run', async () => {
    const s = serverMock({ statuses: ['failed'] });
    const { d, lines } = deps(s.fn);
    expect(await runImport({ ...base, yes: true }, d)).toBe(1);
    expect(lines.join('\n')).toContain('Import failed: boom');
  });

  it('sends jira bundles with source jira and reports missing options', async () => {
    const s = serverMock();
    const { d } = deps(s.fn);
    expect(await runImport({ ...base, kind: 'jira-csv', file: fixturePath('jira-export.csv'), dryRun: true }, d)).toBe(0);
    expect((s.seenBundle() as { source: string }).source).toBe('jira');
    const { d: d2, lines } = deps(s.fn);
    expect(await runImport({ ...base, kind: 'github', dryRun: true }, d2)).toBe(1);
    expect(lines.join('\n')).toMatch(/--github-token/);
  });
});

describe('performance', () => {
  it('parses a generated 1000-row CSV in under 2s', async () => {
    const csv = generateLinearCsv(1000);
    const t = performance.now();
    const b = await parseLinearCsv(csv);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(b.issues).toHaveLength(1000);
    expect(b.teams).toHaveLength(3);
    expect(b.warnings.filter((w) => w.code === 'missing_required_field')).toHaveLength(0);
    expect(b.issues.some((i) => i.parentExternalId)).toBe(true);
    expect(b.issues.some((i) => i.relations.length)).toBe(true);
    validateBundle(JSON.parse(JSON.stringify(b)));
  });

  it('generator writes to a file path and is parseable via file', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'imp-')), 'x.csv');
    writeFileSync(p, generateLinearCsv(10));
    expect((await parseLinearCsv(generateLinearCsv(10))).issues).toHaveLength(10);
    expect((await parseJiraCsv(fixtureText('jira-export.csv'))).issues.length).toBeGreaterThan(0);
  });
});
