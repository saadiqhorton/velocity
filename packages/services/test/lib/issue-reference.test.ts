import { describe, expect, it } from 'vitest';
import { extractIssueRefsFromBranch, findIssueReferences, type IssueReference } from '../../src/lib/issue-reference';

const KEYS = ['ENG', 'OPS', 'E2'];
const ids = (r: IssueReference[]) => r.map((x) => (x.kind === 'identifier' ? x.identifier : x.issueId));
const UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('findIssueReferences identifiers', () => {
  it('finds plain, case-insensitive references with index', () => {
    const r = findIssueReferences('see eng-12 and OPS-3.', KEYS);
    expect(r).toEqual([
      { kind: 'identifier', identifier: 'ENG-12', teamKey: 'ENG', number: 12, closes: false, index: 4 },
      { kind: 'identifier', identifier: 'OPS-3', teamKey: 'OPS', number: 3, closes: false, index: 15 },
    ]);
  });
  it('matches only existing keys', () => expect(ids(findIssueReferences('FOO-1 ENG-2', KEYS))).toEqual(['ENG-2']));
  it('accepts lowercase key list', () => expect(ids(findIssueReferences('ENG-2', ['eng']))).toEqual(['ENG-2']));
  it('no keys, no refs', () => expect(findIssueReferences('ENG-1', [])).toEqual([]));
  it('does not match inside longer words or with trailing alnum', () => {
    expect(findIssueReferences('XENG-12', KEYS)).toEqual([]);
    expect(findIssueReferences('ENG-12a', KEYS)).toEqual([]);
    expect(findIssueReferences('1ENG-12', KEYS)).toEqual([]);
    expect(findIssueReferences('ENG-', KEYS)).toEqual([]);
    expect(findIssueReferences('ENG12', KEYS)).toEqual([]);
    expect(findIssueReferences('ENG-0', KEYS)).toEqual([]);
  });
  it('matches punctuation-adjacent and branch-style refs', () => {
    expect(ids(findIssueReferences('(ENG-1), [ENG-2]; "ENG-3" ENG-4?', KEYS))).toEqual(['ENG-1', 'ENG-2', 'ENG-3', 'ENG-4']);
    expect(ids(findIssueReferences('eng-123-fix-login', KEYS))).toEqual(['ENG-123']);
    expect(ids(findIssueReferences('feature/ENG-123', KEYS))).toEqual(['ENG-123']);
  });
  it('handles digit-containing keys and longest-key preference', () => {
    expect(ids(findIssueReferences('E2-5', KEYS))).toEqual(['E2-5']);
    expect(ids(findIssueReferences('AB-1 ABC-2', ['AB', 'ABC']))).toEqual(['AB-1', 'ABC-2']);
  });
  it('dedupes identical identifiers', () => {
    const r = findIssueReferences('ENG-1 then eng-1 again', KEYS);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ index: 0, closes: false });
  });
});

describe('close intent', () => {
  it.each(['fix', 'Fixes', 'FIXED', 'close', 'closes', 'Closed', 'resolve', 'Resolves', 'resolved'])('%s closes', (kw) => {
    const [r] = findIssueReferences(`${kw} ENG-1`, KEYS);
    expect(r).toMatchObject({ closes: true });
  });
  it('allows colon and multiple whitespace/newline', () => {
    expect(findIssueReferences('Fixes: ENG-1', KEYS)[0]).toMatchObject({ closes: true });
    expect(findIssueReferences('Fixes:ENG-1', KEYS)[0]).toMatchObject({ closes: true });
    expect(findIssueReferences('closes   ENG-1', KEYS)[0]).toMatchObject({ closes: true });
    expect(findIssueReferences('Resolves\nENG-1', KEYS)[0]).toMatchObject({ closes: true });
    expect(findIssueReferences('Body.\n\nFixes ENG-1', KEYS)[0]).toMatchObject({ closes: true });
  });
  it('keyword must be a whole word and immediately before', () => {
    expect(findIssueReferences('prefix ENG-1', KEYS)[0]).toMatchObject({ closes: false });
    expect(findIssueReferences('unfixes ENG-1', KEYS)[0]).toMatchObject({ closes: false });
    expect(findIssueReferences('fix the bug in ENG-1', KEYS)[0]).toMatchObject({ closes: false });
    expect(findIssueReferences('fixing ENG-1', KEYS)[0]).toMatchObject({ closes: false });
    expect(findIssueReferences('ENG-1 fixes', KEYS)[0]).toMatchObject({ closes: false });
  });
  it('applies only to the immediately following reference', () => {
    const r = findIssueReferences('Fixes ENG-1, ENG-2', KEYS);
    expect(r.map((x) => x.kind === 'identifier' && x.closes)).toEqual([true, false]);
    const r2 = findIssueReferences('Fixes ENG-1, fixes ENG-2', KEYS);
    expect(r2.map((x) => x.kind === 'identifier' && x.closes)).toEqual([true, true]);
  });
  it('dedupe keeps closes = true if any occurrence closes', () => {
    const r = findIssueReferences('ENG-1 is related. Fixes ENG-1', KEYS);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ closes: true, index: 0 });
    const r2 = findIssueReferences('Fixes ENG-1 and ENG-1', KEYS);
    expect(r2).toHaveLength(1);
    expect(r2[0]).toMatchObject({ closes: true });
  });
});

describe('url references', () => {
  it('finds urls on any host without appUrl', () => {
    const r = findIssueReferences(`see https://velocity.example.com/issue/${UUID} ok`, KEYS);
    expect(r).toEqual([{ kind: 'url', issueId: UUID, index: 4 }]);
  });
  it('restricts to appUrl host (incl. port)', () => {
    const t = `http://localhost:3000/issue/${UUID} https://evil.com/issue/${UUID.replace('123e', '999e')}`;
    expect(ids(findIssueReferences(t, KEYS, { appUrl: 'http://localhost:3000' }))).toEqual([UUID]);
    expect(findIssueReferences(t, KEYS, { appUrl: 'https://other.example' })).toEqual([]);
    expect(ids(findIssueReferences(t, KEYS))).toHaveLength(2);
  });
  it('lowercases ids, dedupes, ignores malformed uuids', () => {
    const up = UUID.toUpperCase();
    const r = findIssueReferences(`https://a.b/issue/${up} https://a.b/issue/${UUID}`, KEYS);
    expect(r).toHaveLength(1);
    expect(findIssueReferences('https://a.b/issue/not-a-uuid', KEYS)).toEqual([]);
    expect(findIssueReferences(`https://a.b/issue/${UUID}0`, KEYS)).toEqual([]);
  });
  it('invalid appUrl falls back to any host; mixed results sorted by index', () => {
    const r = findIssueReferences(`ENG-1 https://a.b/issue/${UUID} ENG-2`, KEYS, { appUrl: 'not a url' });
    expect(r.map((x) => x.index)).toEqual([0, 6, 6 + `https://a.b/issue/${UUID} `.length]);
  });
});

describe('extractIssueRefsFromBranch', () => {
  it.each([
    ['eng-123-fix-login', ['ENG-123']],
    ['feature/ENG-123', ['ENG-123']],
    ['feature/eng-1-and-ops-2', ['ENG-1', 'OPS-2']],
    ['user/eng-5_something', ['ENG-5']],
    ['main', []],
    ['xeng-5', []],
    ['eng-5a', []],
    ['eng-5-eng-5', ['ENG-5']],
  ])('%s', (b, expected) => expect(ids(extractIssueRefsFromBranch(b, KEYS))).toEqual(expected));
  it('never reports close intent', () => {
    const r = extractIssueRefsFromBranch('fix-eng-1', KEYS);
    expect(r[0]).toMatchObject({ closes: false });
  });
});
