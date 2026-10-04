import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AGENT_GUIDE, createHttpExecutor, normalizeIssueRef, parsePriority, toolDefinitions } from '../src/index';
import { mergeDsl, splitOrder } from '../src/dsl';

const def = (name: string) => {
  const d = toolDefinitions.find((t) => t.name === name);
  if (!d) throw new Error(`no tool ${name}`);
  return z.object(d.shape);
};

describe('zod input validation', () => {
  it('create_issue', () => {
    const s = def('create_issue');
    expect(s.safeParse({ team_key: 'ENG', title: 'x', priority: 'urgent', labels: ['Bug'], assignee: 'me' }).success).toBe(true);
    expect(s.safeParse({ team_key: 'ENG', title: 'x', priority: 0 }).success).toBe(true);
    expect(s.safeParse({ team_key: 'ENG', title: 'x', priority: 5 }).success).toBe(false);
    expect(s.safeParse({ team_key: 'ENG', title: 'x', priority: 'asap' }).success).toBe(false);
    expect(s.safeParse({ team_key: 'ENG', title: '   ' }).success).toBe(false);
    expect(s.safeParse({ team_key: 'E N', title: 'x' }).success).toBe(false);
    expect(s.safeParse({ title: 'x' }).success).toBe(false);
    expect(s.safeParse({ team_key: 'ENG', title: 'x', labels: 'Bug' }).success).toBe(false);
  });
  it('issue references', () => {
    const s = def('get_issue');
    for (const ok of ['ENG-1', 'eng-123', '0190f6c2-1111-7222-8333-444455556666', 'https://x.test/issue/0190f6c2-1111-7222-8333-444455556666']) {
      expect(s.safeParse({ identifier: ok }).success, ok).toBe(true);
    }
    for (const bad of ['ENG', 'ENG-', '123', 'drop table', '']) expect(s.safeParse({ identifier: bad }).success, bad).toBe(false);
  });
  it('assign_issue requires assignee (nullable)', () => {
    const s = def('assign_issue');
    expect(s.safeParse({ identifier: 'ENG-1', assignee: null }).success).toBe(true);
    expect(s.safeParse({ identifier: 'ENG-1' }).success).toBe(false);
  });
  it('update_issue patch fields', () => {
    const s = def('update_issue');
    expect(s.safeParse({ issue_id: 'ENG-1', patch: { assignee: null, cycle_id: null, parent: null, estimate: 5 } }).success).toBe(true);
    expect(s.safeParse({ issue_id: 'ENG-1', patch: { project_id: 'not-a-uuid' } }).success).toBe(false);
    expect(s.safeParse({ issue_id: 'ENG-1', patch: { estimate: 1.5 } }).success).toBe(false);
  });
  it('list/search limits and enums', () => {
    expect(def('list_issues').safeParse({ limit: 51 }).success).toBe(false);
    expect(def('search_issues').safeParse({ query: '' }).success).toBe(false);
    expect(def('manage_labels').safeParse({ action: 'toggle', identifier: 'ENG-1' }).success).toBe(false);
    expect(def('list_projects').safeParse({ status: 'bogus' }).success).toBe(false);
    expect(def('list_projects').safeParse({ status: 'in_progress' }).success).toBe(true);
  });
  it('helpers', () => {
    expect(parsePriority('High')).toBe(1);
    expect(parsePriority('no priority')).toBe(4);
    expect(parsePriority('3')).toBe(3);
    expect(parsePriority(7)).toBeNull();
    expect(normalizeIssueRef(' eng-12 ')).toBe('ENG-12');
    expect(normalizeIssueRef('https://h/issue/0190f6c2-1111-7222-8333-444455556666')).toBe('0190f6c2-1111-7222-8333-444455556666');
  });
});

describe('DSL merge', () => {
  it('keeps the order clause last and parenthesises user filters', () => {
    expect(splitOrder('priority lt:2 order:priority asc')).toEqual({ filter: 'priority lt:2', order: 'order:priority asc' });
    expect(mergeDsl('priority lt:2 order:priority asc', ['status:"In Progress"', 'assignee:me'])).toBe('(priority lt:2) and status:"In Progress" and assignee:me order:priority asc');
    expect(mergeDsl(undefined, ['assignee:me'])).toBe('assignee:me');
    expect(mergeDsl('a:b or c:d', [])).toBe('a:b or c:d');
    expect(mergeDsl(undefined, [])).toBeUndefined();
    expect(mergeDsl('order:priority', ['assignee:me'])).toBe('assignee:me order:priority');
  });
});

describe('docs/agents.md stays in sync with the MCP prompt', () => {
  it('matches', () => {
    const md = readFileSync(new URL('../../../docs/agents.md', import.meta.url), 'utf8');
    expect(AGENT_GUIDE).toBe(md);
  });
});

describe('createHttpExecutor', () => {
  function mockFetch(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }) as typeof fetch;
    return { f, calls };
  }

  it('posts to /graphql with Authorization and X-MCP-Session-Id', async () => {
    const { f, calls } = mockFetch(200, { data: { ok: 1 } });
    const exec = createHttpExecutor({ url: 'https://v.test/', apiKey: 'vel_abc', mcpSessionId: 'sess-1', fetch: f });
    const res = await exec('query { x }', { a: 1 });
    expect(res.data).toEqual({ ok: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://v.test/graphql');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('vel_abc');
    expect(headers['x-mcp-session-id']).toBe('sess-1');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ query: 'query { x }', variables: { a: 1 } });
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('omits the session header when unset', async () => {
    const { f, calls } = mockFetch(200, { data: {} });
    await createHttpExecutor({ url: 'http://localhost', apiKey: 'k', fetch: f })('query { x }');
    expect(Object.keys(calls[0]?.init.headers as Record<string, string>)).not.toContain('x-mcp-session-id');
  });

  it('passes GraphQL errors through, even on non-200', async () => {
    const { f } = mockFetch(400, { errors: [{ message: 'bad', extensions: { code: 'VALIDATION' } }] });
    const res = await createHttpExecutor({ url: 'http://x', apiKey: 'k', fetch: f })('q');
    expect(res.errors?.[0]?.extensions?.code).toBe('VALIDATION');
  });

  it('maps bare HTTP failures to typed codes', async () => {
    for (const [status, code] of [[401, 'UNAUTHENTICATED'], [429, 'RATE_LIMITED']] as const) {
      const { f } = mockFetch(status, 'nope');
      const res = await createHttpExecutor({ url: 'http://x', apiKey: 'k', fetch: f })('q');
      expect(res.errors?.[0]?.extensions?.code).toBe(code);
    }
  });

  it('throws on a non-GraphQL 200 body', async () => {
    const { f } = mockFetch(200, '<html>');
    await expect(createHttpExecutor({ url: 'http://x', apiKey: 'k', fetch: f })('q')).rejects.toThrow();
  });
});
