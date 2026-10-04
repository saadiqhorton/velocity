import { describe, expect, it } from 'vitest';
import { DslError, parseFilter } from './index';
import { buildCaret, dslError } from './errors';

function err(input: string): DslError {
  try {
    parseFilter(input);
  } catch (e) {
    if (e instanceof DslError) return e;
    throw e;
  }
  throw new Error(`expected DslError for: ${input}`);
}

/** [input, expected 0-based position, message regex] */
const CASES: [string, number, RegExp][] = [
  ['foo:bar', 0, /Unknown field 'foo'/],
  ['team:A foo:bar', 7, /Unknown field 'foo'/],
  ['team', 4, /Expected ':'/],
  ['team ENG', 5, /Expected ':'/],
  ['team:', 5, /Expected a value/],
  ['team: ENG', 5, /Expected a value/],
  ['team :ENG', 5, /Expected ':'/],
  ['priority foo:1', 9, /Unknown operator 'foo'/],
  ['priority contains:1', 9, /not supported/],
  ['title gt:5', 6, /not supported/],
  ['identifier in:ENG', 14, /Invalid identifier/],
  ['title:"unterminated', 6, /Unterminated string/],
  ['title:"bad \\q escape"', 11, /escape/],
  ['team:A and', 10, /Expected a filter expression/],
  ['and team:A', 0, /Expected a filter expression/],
  ['team:A or', 9, /Expected a filter expression/],
  ['team:A or or team:B', 10, /Expected a filter expression/],
  ['(team:A', 7, /Missing closing/],
  ['team:A)', 6, /Unmatched/],
  ['()', 1, /Empty parentheses/],
  ['(team:A team:B', 14, /Missing closing/],
  ['not', 3, /Expected a filter expression/],
  ['team:A $', 7, /Unexpected character/],
  ['team:A & team:B', 7, /Unexpected character/],
  [',', 0, /Expected a filter expression/],
  [':foo', 0, /Expected a filter expression/],
  ['title:"a"b', 9, /separate terms/],
  ['priority:7', 9, /between 0 and 4/],
  ['statusCategory:wip', 15, /Invalid status category/],
  ['createdAt gt:nope', 13, /Invalid date/],
  ['team:A order:nope', 13, /Unknown order field/],
  ['order:priority team:A', 15, /Unexpected/],
  ['team:A (', 8, /Expected a filter expression/],
  ['is:nope', 3, /Unknown 'is:' value/],
  ['priority in:1,2,9', 16, /between 0 and 4/],
  ['estimate:100', 9, /0 and 40/],
];

describe('error positions and carets', () => {
  it('has at least 15 cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(15);
  });
  for (const [input, position, re] of CASES) {
    it(`reports ${JSON.stringify(input)} at ${position}`, () => {
      const e = err(input);
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe('DslError');
      expect(e.info.position).toBe(position);
      expect(e.info.message).toMatch(re);
      expect(e.message).toBe(e.info.message);
      expect(e.info.caret).toBe(`${input}\n${' '.repeat(position)}^`);
    });
  }
});

describe('helpers', () => {
  it('buildCaret clamps position', () => {
    expect(buildCaret('abc', 99)).toBe('abc\n   ^');
    expect(buildCaret('abc', -4)).toBe('abc\n^');
  });
  it('dslError builds info', () => {
    const e = dslError('xyz', 1, 'boom');
    expect(e.info).toEqual({ message: 'boom', position: 1, caret: 'xyz\n ^' });
  });
});
