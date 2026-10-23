import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch, fuzzyScore, fuzzySearch, matchRuns } from './fuzzy';

const score = (q: string, t: string): number => fuzzyScore(q, t) ?? Number.NEGATIVE_INFINITY;

describe('fuzzyScore', () => {
  it('empty query matches everything with 0', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('   ', 'anything')).toBe(0);
  });
  it('is case-insensitive', () => {
    expect(fuzzyScore('GO', 'Go to inbox')).not.toBeNull();
  });
  it('prefix beats middle', () => {
    expect(score('in', 'Inbox')).toBeGreaterThan(score('in', 'Open window'));
    expect(score('go', 'Go to team')).toBeGreaterThan(score('go', 'Navigate to Gogo'));
  });
  it('word-boundary substring beats mid-word substring', () => {
    expect(score('box', 'Open box')).toBeGreaterThan(score('box', 'Inbox'));
    expect(score('team', 'Go to-team')).toBeGreaterThan(score('team', 'Steam'));
  });
  it('shorter text wins on equal position', () => {
    expect(score('in', 'Inbox')).toBeGreaterThan(score('in', 'Inbox settings'));
  });
  it('matches subsequences', () => {
    expect(fuzzyScore('gti', 'Go to inbox')).not.toBeNull();
    expect(fuzzyScore('cni', 'Create new issue')).not.toBeNull();
  });
  it('contiguous and boundary subsequence hits score higher', () => {
    expect(score('cni', 'Create new issue')).toBeGreaterThan(score('cni', 'Cxxxxxxxnxxxxxxxi'));
  });
  it('substring beats subsequence', () => {
    expect(score('new', 'Create new issue')).toBeGreaterThan(score('cni', 'Create new issue'));
  });
  it('returns null when characters are missing or out of order', () => {
    expect(fuzzyScore('xyz', 'Inbox')).toBeNull();
    expect(fuzzyScore('xob', 'Inbox')).toBeNull();
  });
  it('ignores spaces inside a subsequence query', () => {
    expect(fuzzyScore('g i', 'Go to inbox')).not.toBeNull();
  });
});

describe('fuzzyFilter', () => {
  const items = ['Open window', 'Inbox', 'Go to Inbox', 'Settings'];
  it('sorts by score and drops non-matches', () => {
    expect(fuzzyFilter(items, 'inbox', (s) => s)).toEqual(['Inbox', 'Go to Inbox']);
  });
  it('empty query returns the first `limit` items in order', () => {
    expect(fuzzyFilter(items, '', (s) => s, 2)).toEqual(['Open window', 'Inbox']);
  });
  it('respects limit', () => {
    expect(fuzzyFilter(items, 'o', (s) => s, 1)).toHaveLength(1);
  });
});

describe('fuzzyMatch indices', () => {
  it('marks the whole run for a substring hit', () => {
    expect(fuzzyMatch('box', 'Open box')?.indices).toEqual([5, 6, 7]);
  });
  it('marks each subsequence character in order', () => {
    // G(0) … t(3) … i(6): the chars of "gti" in "Go to inbox".
    expect(fuzzyMatch('gti', 'Go to inbox')?.indices).toEqual([0, 3, 6]);
  });
  it('skips spaces in the query', () => {
    expect(fuzzyMatch('g i', 'Go to inbox')?.indices).toEqual([0, 6]);
  });
  it('is case-insensitive and reports the original positions', () => {
    expect(fuzzyMatch('INB', 'Go to Inbox')?.indices).toEqual([6, 7, 8]);
  });
  it('returns no indices for an empty query, and null for no match', () => {
    expect(fuzzyMatch('  ', 'anything')).toEqual({ score: 0, indices: [] });
    expect(fuzzyMatch('xyz', 'Inbox')).toBeNull();
  });
  it('agrees with fuzzyScore', () => {
    for (const [q, t] of [
      ['in', 'Inbox'],
      ['cni', 'Create new issue'],
      ['xob', 'Inbox'],
    ] as const) {
      expect(fuzzyMatch(q, t)?.score ?? null).toBe(fuzzyScore(q, t));
    }
  });
});

describe('fuzzySearch', () => {
  it('returns ranked items with their indices', () => {
    const results = fuzzySearch(['Open window', 'Inbox'], 'inb', (s) => s);
    expect(results).toEqual([{ item: 'Inbox', indices: [0, 1, 2] }]);
  });
  it('gives empty indices when the query is empty, honouring the limit', () => {
    expect(fuzzySearch(['a', 'b', 'c'], '', (s) => s, 2)).toEqual([
      { item: 'a', indices: [] },
      { item: 'b', indices: [] },
    ]);
  });
});

describe('matchRuns', () => {
  it('splits text into matched and unmatched runs', () => {
    expect(matchRuns('Set status', [4, 5, 6, 7])).toEqual([
      { text: 'Set ', matched: false },
      { text: 'stat', matched: true },
      { text: 'us', matched: false },
    ]);
  });
  it('returns one unmatched run when nothing matches', () => {
    expect(matchRuns('Inbox', [])).toEqual([{ text: 'Inbox', matched: false }]);
  });
  it('ignores indices past the end of the text', () => {
    expect(matchRuns('ab', [1, 9])).toEqual([
      { text: 'a', matched: false },
      { text: 'b', matched: true },
    ]);
  });
});
