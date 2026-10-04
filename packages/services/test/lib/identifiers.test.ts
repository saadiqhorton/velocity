import { describe, expect, it } from 'vitest';
import { formatIdentifier, isValidTeamKey, parseIdentifier, slugify, suggestTeamKey } from '../../src/lib/identifiers';

describe('parseIdentifier', () => {
  it.each([
    ['ENG-12', 'ENG', 12],
    ['eng-12', 'ENG', 12],
    ['Eng-1', 'ENG', 1],
    ['A-9', 'A', 9],
    ['ABCDEFGHIJ-100000', 'ABCDEFGHIJ', 100000],
    [' eng-5 ', 'ENG', 5],
    ['E2E-3', 'E2E', 3],
  ])('%s', (s, teamKey, number) => expect(parseIdentifier(s)).toEqual({ teamKey, number }));
  it.each(['', 'ENG', 'ENG-', '-12', 'ENG-0', 'ENG-1a', '1ENG-1', 'ENG--1', 'ENG-1-2', 'ABCDEFGHIJK-1', 'ENG 12', 'ENG-99999999999999999999', 'ENG-1.5', 'ENG-+1'])(
    'rejects %j',
    (s) => expect(parseIdentifier(s)).toBeNull(),
  );
});

describe('formatIdentifier', () => {
  it('uppercases', () => {
    expect(formatIdentifier('eng', 7)).toBe('ENG-7');
    expect(parseIdentifier(formatIdentifier('Ab1', 42))).toEqual({ teamKey: 'AB1', number: 42 });
  });
});

describe('isValidTeamKey', () => {
  it.each(['A', 'ENG', 'A1B2', 'ABCDEFGHIJ'])('accepts %s', (k) => expect(isValidTeamKey(k)).toBe(true));
  it.each(['', 'eng', '1AB', 'ABCDEFGHIJK', 'AB-C', 'AB C', 'ÄB'])('rejects %j', (k) => expect(isValidTeamKey(k)).toBe(false));
});

describe('suggestTeamKey', () => {
  const none = new Set<string>();
  it('uses initials for multi-word names', () => expect(suggestTeamKey('Customer Success Team', none)).toBe('CST'));
  it('uses first letters for single words', () => expect(suggestTeamKey('Engineering', none)).toBe('ENG'));
  it('widens when taken', () => {
    expect(suggestTeamKey('Engineering', new Set(['ENG']))).toBe('ENGI');
    expect(suggestTeamKey('Engineering', new Set(['ENG', 'ENGI']))).toBe('ENGIN');
  });
  it('strips diacritics and punctuation', () => expect(suggestTeamKey('Écologie & Co', none)).toBe('EC'));
  it('falls back to TEAM for non-latin / numeric names', () => {
    expect(suggestTeamKey('日本語', none)).toBe('TEAM');
    expect(suggestTeamKey('123', none)).toBe('TEAM');
    expect(suggestTeamKey('', none)).toBe('TEAM');
  });
  it('adds numeric suffix when everything is taken', () => {
    const taken = new Set(['AB', 'ABC']);
    expect(suggestTeamKey('ab', taken)).toBe('AB2');
  });
  it('always returns a valid unused key', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const k = suggestTeamKey('Platform', taken);
      expect(isValidTeamKey(k)).toBe(true);
      expect(taken.has(k)).toBe(false);
      taken.add(k);
    }
  });
});

describe('slugify', () => {
  it.each([
    ['Hello World', 'hello-world'],
    ['  --Hello,   World!!  ', 'hello-world'],
    ['Crème Brûlée', 'creme-brulee'],
    ['日本語 ワークスペース', '日本語-ワークスペース'],
    ['Привет мир', 'привет-мир'],
    ['a_b.c/d', 'a-b-c-d'],
    ['!!!', ''],
    ['', ''],
    ['UPPER', 'upper'],
  ])('%j -> %j', (i, o) => expect(slugify(i)).toBe(o));
  it('caps at 64 chars and never ends in a dash', () => {
    const s = slugify('a'.repeat(100));
    expect(s).toHaveLength(64);
    const t = slugify('word '.repeat(30));
    expect(Array.from(t).length).toBeLessThanOrEqual(64);
    expect(t.endsWith('-')).toBe(false);
  });
  it('counts code points, not UTF-16 units', () => {
    const s = slugify('😀'.repeat(10) + '日'.repeat(100));
    expect(Array.from(s).length).toBeLessThanOrEqual(64);
    expect(s).not.toMatch(/[\ud800-\udbff]$/);
  });
  it('is idempotent', () => {
    for (const s of ['Hello World', '日本語 x', 'a--b']) expect(slugify(slugify(s))).toBe(slugify(s));
  });
});
