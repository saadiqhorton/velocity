import { describe, expect, it } from 'vitest';
import { BRANCH_MAX, branchName, buildIssuePrompt, slugify } from './prompt';
import type { PromptIssue } from './prompt';

const base: PromptIssue = {
  identifier: 'ENG-123',
  title: 'Fix the login flow',
  url: 'https://velocity.example/issue/0190-uuid',
  descriptionMd: '',
  status: { name: 'In Progress' },
  priority: 1,
  labels: [],
  project: null,
  milestone: null,
  children: [],
  relations: [],
};
const relative = () => '2d ago';

describe('slugify', () => {
  it('folds accents and drops non-ASCII', () => {
    expect(slugify('Ünïcödé Café crème')).toBe('unicode-cafe-creme');
    expect(slugify('Straße & Smørrebrød — œuvre')).toBe('strasse-smorrebrod-oeuvre');
    expect(slugify('修复 登录 bug 🚀')).toBe('bug');
    expect(slugify('  --Hello__World!!  ')).toBe('hello-world');
    expect(slugify('')).toBe('');
  });
});

describe('branchName', () => {
  it('prefixes the lowercase identifier', () => {
    expect(branchName('ENG-123', 'Fix the login flow')).toBe('eng-123-fix-the-login-flow');
  });
  it('is at most 60 characters and cut at a word boundary', () => {
    const b = branchName('ENG-123', 'Define a versioned host capability model for remote SSH sessions and agents');
    expect(b.length).toBeLessThanOrEqual(BRANCH_MAX);
    expect(b).toBe('eng-123-define-a-versioned-host-capability-model-for-remote');
    expect(b.endsWith('-')).toBe(false);
  });
  it('hard-cuts a single very long word', () => {
    const b = branchName('ENG-1', 'x'.repeat(200));
    expect(b).toHaveLength(BRANCH_MAX);
    expect(b.startsWith('eng-1-xxx')).toBe(true);
  });
  it('falls back to the identifier when the title has no ASCII words', () => {
    expect(branchName('ENG-9', '修复登录')).toBe('eng-9');
    expect(branchName('ENG-9', '')).toBe('eng-9');
  });
  it('only ever contains lowercase ASCII, digits and single dashes', () => {
    for (const title of ['Ärger mit "Quotes" & $vars', 'a — b — c', '🚀🚀 launch!!', 'Tabs\tand\nnewlines']) {
      expect(branchName('WEB-42', title)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe('buildIssuePrompt', () => {
  it('renders the canonical template with every section', () => {
    const prompt = buildIssuePrompt(
      {
        ...base,
        descriptionMd: 'Login fails on **Safari**.\n\n- step one',
        labels: [{ name: 'Bug' }, { name: 'Backend' }],
        project: { name: 'RemoteHub' },
        milestone: { name: 'Foundation' },
        children: [
          { identifier: 'ENG-124', title: 'Add explicit SSH regression tests', status: { category: 'done' } },
          { identifier: 'ENG-125', title: 'Define versioned host capability model', status: { category: 'todo' } },
        ],
        relations: [
          { type: 'blocked_by', issue: { identifier: 'ENG-118', title: 'Auth refactor' } },
          { type: 'blocks', issue: { identifier: 'ENG-130', title: 'Release' } },
        ],
      },
      { relative, comments: [{ author: 'Saadiq', createdAt: '2026-10-03T00:00:00Z', bodyMd: 'Repro on 17.2\nalso on iOS' }], instructions: 'Run pnpm test.' },
    );
    expect(prompt).toBe(
      [
        '# ENG-123: Fix the login flow',
        'https://velocity.example/issue/0190-uuid',
        '',
        '**Status:** In Progress · **Priority:** High · **Labels:** Bug, Backend · **Project:** RemoteHub › Foundation',
        '',
        '## Description',
        'Login fails on **Safari**.',
        '',
        '- step one',
        '',
        '## Sub-issues',
        '- [x] ENG-124 Add explicit SSH regression tests',
        '- [ ] ENG-125 Define versioned host capability model',
        '',
        '## Related',
        '- Blocks ENG-130 Release',
        '- Blocked by ENG-118 Auth refactor',
        '',
        '## Recent comments',
        '> **Saadiq** (2d ago): Repro on 17.2',
        '> also on iOS',
        '',
        '## Working agreement',
        '- Branch: `eng-123-fix-the-login-flow`',
        '- Mention `ENG-123` in commits; put `Fixes ENG-123` in the PR description to close it on merge.',
        '- If the Velocity MCP server is available, use it to read related issues, post progress comments and update status.',
        'Run pnpm test.',
        '',
      ].join('\n'),
    );
  });

  it('skips empty sections and optional meta', () => {
    const prompt = buildIssuePrompt({ ...base, descriptionMd: '   ', priority: 4 }, { relative, comments: [], instructions: '  ' });
    expect(prompt).not.toMatch(/## Description|## Sub-issues|## Related|## Recent comments|Labels|Project/);
    expect(prompt).toContain('**Status:** In Progress · **Priority:** No priority\n');
    expect(prompt.trimEnd().endsWith('update status.')).toBe(true);
  });

  it('keeps only the last five comments, newest last, and ignores blank ones', () => {
    const comments = Array.from({ length: 8 }, (_, i) => ({ author: `U${i}`, createdAt: '2026-10-01T00:00:00Z', bodyMd: i === 7 ? '  ' : `c${i}` }));
    const prompt = buildIssuePrompt(base, { relative, comments });
    expect(prompt).not.toContain('**U0**');
    expect(prompt).not.toContain('**U1**');
    expect(prompt).toContain('> **U2** (2d ago): c2');
    expect(prompt.indexOf('**U6**')).toBeGreaterThan(prompt.indexOf('**U5**'));
    expect(prompt).not.toContain('**U7**');
  });

  it('keeps unicode titles verbatim and uses an ASCII branch', () => {
    const prompt = buildIssuePrompt({ ...base, title: 'Café: 修复登录 🚀' }, { relative });
    expect(prompt.startsWith('# ENG-123: Café: 修复登录 🚀\n')).toBe(true);
    expect(prompt).toContain('- Branch: `eng-123-cafe`');
  });

  it('handles very long titles', () => {
    const title = 'word '.repeat(80).trim();
    const prompt = buildIssuePrompt({ ...base, title }, { relative });
    expect(prompt).toContain(`# ENG-123: ${title}`);
    const branch = /Branch: `([^`]+)`/.exec(prompt)?.[1] ?? '';
    expect(branch.length).toBeLessThanOrEqual(60);
  });
});
