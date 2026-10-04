import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy';

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
