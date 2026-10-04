import { describe, expect, it } from 'vitest';
import { FILTER_FIELDS, FILTER_OPS } from '@velocity/schema/filter-ast';
import type { FilterField, FilterNode, FilterOp } from '@velocity/schema/filter-ast';
import { DslError, FILTER_FIELD_SPECS, parseFilter } from './index';

const f = (s: string): FilterNode | null => parseFilter(s).filter;
const cmp = (field: FilterField, op: FilterOp, value: unknown): FilterNode =>
  ({ type: 'cmp', field, op, value }) as FilterNode;
const str = (value: string) => ({ kind: 'string', value });
const num = (value: number) => ({ kind: 'number', value });

function err(input: string): DslError {
  try {
    parseFilter(input);
  } catch (e) {
    if (e instanceof DslError) return e;
    throw e;
  }
  throw new Error(`expected DslError for: ${input}`);
}

/** A sample valid value per field for op tests. */
const SAMPLE: Record<FilterField, string> = {
  team: 'ENG',
  status: '"In Progress"',
  statusCategory: 'done',
  assignee: 'alice',
  creator: 'bob',
  priority: '2',
  label: 'bug',
  project: 'Apollo',
  cycle: 'current',
  estimate: '5',
  createdAt: '2026-01-31',
  updatedAt: '-2w',
  completedAt: '2026-01-31',
  title: 'login',
  description: 'crash',
  identifier: 'ENG-12',
  parent: 'ENG-1',
  relations: 'blocks',
};

describe('every field x every op', () => {
  for (const field of FILTER_FIELDS) {
    const spec = FILTER_FIELD_SPECS[field];
    for (const op of FILTER_OPS) {
      const allowed = spec.ops.includes(op);
      const isSet = op === 'in' || op === 'nin';
      // completedAt neq only accepts empty
      const value = field === 'completedAt' && op === 'neq' ? 'empty' : SAMPLE[field];
      const src = op === 'eq' ? `${field}:${value}` : `${field} ${op}:${value}`;
      if (allowed) {
        it(`accepts ${field} ${op}`, () => {
          const node = f(src);
          expect(node).not.toBeNull();
          if (node && node.type === 'cmp') {
            expect(node.field).toBe(field);
            expect(node.op).toBe(op);
            expect(node.value.kind === 'list').toBe(isSet);
          } else {
            throw new Error('expected cmp');
          }
        });
      } else {
        it(`rejects ${field} ${op}`, () => {
          const e = err(src);
          expect(e.info.message).toMatch(/not supported/);
          expect(e.info.position).toBe(op === 'eq' ? 0 : field.length + 1);
        });
      }
    }
  }
  it('has specs for all fields', () => {
    expect(Object.keys(FILTER_FIELD_SPECS).sort()).toEqual([...FILTER_FIELDS].sort());
  });
});

describe('basic comparisons and normalization', () => {
  it('parses empty input', () => {
    expect(parseFilter('')).toEqual({ filter: null, order: [] });
    expect(parseFilter('   \n\t ')).toEqual({ filter: null, order: [] });
  });
  it('default op is eq', () => {
    expect(f('team:ENG')).toEqual(cmp('team', 'eq', str('ENG')));
  });
  it('normalizes field casing', () => {
    expect(f('statuscategory:done')).toEqual(cmp('statusCategory', 'eq', str('done')));
    expect(f('STATUSCATEGORY:done')).toEqual(cmp('statusCategory', 'eq', str('done')));
    expect(f('CreatedAt gt:-1d')).toEqual(cmp('createdAt', 'gt', { kind: 'relativeDate', amount: -1, unit: 'd' }));
  });
  it('accepts aliases', () => {
    expect(f('created gt:-1d')).toEqual(f('createdAt gt:-1d'));
    expect(f('updated gt:-1d')).toEqual(f('updatedAt gt:-1d'));
    expect(f('completed gt:-1d')).toEqual(f('completedAt gt:-1d'));
  });
  it('op names are case-insensitive and normalized', () => {
    expect(f('title STARTSWITH:foo')).toEqual(cmp('title', 'startsWith', str('foo')));
    expect(f('title endswith:foo')).toEqual(cmp('title', 'endsWith', str('foo')));
    expect(f('priority LT:2')).toEqual(cmp('priority', 'lt', num(2)));
  });
  it('contains with quoted value', () => {
    expect(f('title contains:"login bug"')).toEqual(cmp('title', 'contains', str('login bug')));
  });
  it('bare words allow _ - . @ /', () => {
    expect(f('assignee:john.doe@example.com')).toEqual(cmp('assignee', 'eq', str('john.doe@example.com')));
    expect(f('label:area/api-v2_x')).toEqual(cmp('label', 'eq', str('area/api-v2_x')));
  });
  it('allows uuids', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(f(`assignee:${id}`)).toEqual(cmp('assignee', 'eq', str(id)));
    expect(f(`parent:${id}`)).toEqual(cmp('parent', 'eq', str(id)));
  });
  it('allows unicode bare words', () => {
    expect(f('label:über')).toEqual(cmp('label', 'eq', str('über')));
  });
});

describe('quoting and escapes', () => {
  it('handles escaped quotes', () => {
    expect(f('title:"say \\"hi\\""')).toEqual(cmp('title', 'eq', str('say "hi"')));
  });
  it('handles escaped backslash', () => {
    expect(f('title:"a\\\\b"')).toEqual(cmp('title', 'eq', str('a\\b')));
  });
  it('quoted strings may contain keywords, parens, colons, commas', () => {
    expect(f('title:"a and (b) or c: d, e"')).toEqual(cmp('title', 'eq', str('a and (b) or c: d, e')));
  });
  it('empty quoted string', () => {
    expect(f('title:""')).toEqual(cmp('title', 'eq', str('')));
  });
  it('quoted me / empty are strings', () => {
    expect(f('assignee:"me"')).toEqual(cmp('assignee', 'eq', str('me')));
    expect(f('assignee:"empty"')).toEqual(cmp('assignee', 'eq', str('empty')));
    expect(f('label:"EMPTY"')).toEqual(cmp('label', 'eq', str('EMPTY')));
  });
  it('bare me / empty are kinds, case-insensitive', () => {
    expect(f('assignee:me')).toEqual(cmp('assignee', 'eq', { kind: 'me' }));
    expect(f('assignee:ME')).toEqual(cmp('assignee', 'eq', { kind: 'me' }));
    expect(f('creator:Empty')).toEqual(cmp('creator', 'eq', { kind: 'empty' }));
  });
  it('me/empty on fields that do not accept them are plain strings', () => {
    expect(f('team:me')).toEqual(cmp('team', 'eq', str('me')));
    expect(f('status:empty')).toEqual(cmp('status', 'eq', str('empty')));
  });
  it('multiline whitespace is accepted', () => {
    expect(f('team:A\n  and\tstatus:B')).toEqual({ type: 'and', children: [cmp('team', 'eq', str('A')), cmp('status', 'eq', str('B'))] });
  });
});

describe('lists', () => {
  it('parses lists of numbers', () => {
    expect(f('priority in:0,1,2')).toEqual(
      cmp('priority', 'in', { kind: 'list', values: [num(0), num(1), num(2)] }),
    );
  });
  it('parses quoted + bare mix', () => {
    expect(f('status in:"In Progress",Todo')).toEqual(
      cmp('status', 'in', { kind: 'list', values: [str('In Progress'), str('Todo')] }),
    );
  });
  it('single value becomes a 1-item list', () => {
    expect(f('status nin:Done')).toEqual(cmp('status', 'nin', { kind: 'list', values: [str('Done')] }));
  });
  it('list with me and empty', () => {
    expect(f('assignee in:me,empty,bob')).toEqual(
      cmp('assignee', 'in', { kind: 'list', values: [{ kind: 'me' }, { kind: 'empty' }, str('bob')] }),
    );
  });
  it('rejects lists for non-set ops', () => {
    const e = err('priority lt:1,2');
    expect(e.info.message).toMatch(/does not accept a list/);
    expect(e.info.position).toBe(12);
    expect(() => parseFilter('team:a,b')).toThrow(DslError);
  });
  it('rejects spaces in lists', () => {
    expect(err('priority in:0, 1').info.position).toBe(14);
    expect(err('priority in:0 ,1').info.position).toBe(14);
  });
  it('rejects trailing comma and leading comma', () => {
    expect(err('priority in:0,').info.position).toBe(14);
    expect(err('priority in:,0').info.position).toBe(12);
  });
  it('validates each list element', () => {
    const e = err('priority in:0,9');
    expect(e.info.position).toBe(14);
  });
  it('statusCategory lists', () => {
    expect(f('statusCategory in:todo,in_progress')).toEqual(
      cmp('statusCategory', 'in', { kind: 'list', values: [str('todo'), str('in_progress')] }),
    );
  });
});

describe('value coercion', () => {
  it('priority numbers', () => {
    for (let i = 0; i <= 4; i++) expect(f(`priority:${i}`)).toEqual(cmp('priority', 'eq', num(i)));
  });
  it('priority names', () => {
    expect(f('priority:urgent')).toEqual(cmp('priority', 'eq', num(0)));
    expect(f('priority:High')).toEqual(cmp('priority', 'eq', num(1)));
    expect(f('priority:medium')).toEqual(cmp('priority', 'eq', num(2)));
    expect(f('priority:low')).toEqual(cmp('priority', 'eq', num(3)));
    expect(f('priority:none')).toEqual(cmp('priority', 'eq', num(4)));
    expect(f('priority:no_priority')).toEqual(cmp('priority', 'eq', num(4)));
  });
  it('priority rejects out-of-range and junk', () => {
    expect(err('priority:5').info.position).toBe(9);
    expect(err('priority:-1').info.position).toBe(9);
    expect(err('priority:abc').info.position).toBe(9);
    expect(err('priority:constructor').info.position).toBe(9);
    expect(err('priority:1.5').info.position).toBe(9);
  });
  it('priority rejects me/empty', () => {
    expect(() => parseFilter('priority:me')).toThrow(DslError);
    expect(() => parseFilter('priority:empty')).toThrow(DslError);
  });
  it('estimate integers 0-40', () => {
    expect(f('estimate:0')).toEqual(cmp('estimate', 'eq', num(0)));
    expect(f('estimate gte:40')).toEqual(cmp('estimate', 'gte', num(40)));
    expect(err('estimate:41').info.message).toMatch(/0 and 40/);
    expect(() => parseFilter('estimate:2.5')).toThrow(DslError);
    expect(() => parseFilter('estimate:big')).toThrow(DslError);
  });
  it('estimate empty', () => {
    expect(f('estimate:empty')).toEqual(cmp('estimate', 'eq', { kind: 'empty' }));
    expect(f('estimate neq:empty')).toEqual(cmp('estimate', 'neq', { kind: 'empty' }));
    expect(() => parseFilter('estimate gt:empty')).toThrow(DslError);
  });
  it('statusCategory enum', () => {
    for (const c of ['backlog', 'todo', 'in_progress', 'done', 'canceled']) {
      expect(f(`statusCategory:${c}`)).toEqual(cmp('statusCategory', 'eq', str(c)));
    }
    expect(f('statusCategory:DONE')).toEqual(cmp('statusCategory', 'eq', str('done')));
    expect(err('statusCategory:started').info.position).toBe(15);
    expect(() => parseFilter('statusCategory:me')).toThrow(DslError);
  });
  it('identifier normalization', () => {
    expect(f('identifier:eng-12')).toEqual(cmp('identifier', 'eq', str('ENG-12')));
    expect(f('identifier in:eng-1,Web-22')).toEqual(
      cmp('identifier', 'in', { kind: 'list', values: [str('ENG-1'), str('WEB-22')] }),
    );
  });
  it('identifier rejects malformed', () => {
    for (const bad of ['ENG', '12-3', 'ENG-', 'ENG-x', 'ABCDEFGHIJK-1', 'E_G-1']) {
      expect(() => parseFilter(`identifier:${bad}`)).toThrow(DslError);
    }
  });
  it('relations values', () => {
    expect(f('relations:blocks')).toEqual(cmp('relations', 'eq', str('blocks')));
    expect(f('relations:BLOCKEDBY')).toEqual(cmp('relations', 'eq', str('blockedBy')));
    expect(f('relations neq:related')).toEqual(cmp('relations', 'neq', str('related')));
    expect(f('relations:empty')).toEqual(cmp('relations', 'eq', { kind: 'empty' }));
    expect(() => parseFilter('relations:parent')).toThrow(DslError);
  });
  it('parent', () => {
    expect(f('parent:empty')).toEqual(cmp('parent', 'eq', { kind: 'empty' }));
    expect(f('parent neq:empty')).toEqual(cmp('parent', 'neq', { kind: 'empty' }));
    expect(f('parent:ENG-4')).toEqual(cmp('parent', 'eq', str('ENG-4')));
  });
  it('label and project empty', () => {
    expect(f('label:empty')).toEqual(cmp('label', 'eq', { kind: 'empty' }));
    expect(f('project:empty')).toEqual(cmp('project', 'eq', { kind: 'empty' }));
    expect(f('label nin:empty')).toEqual(cmp('label', 'nin', { kind: 'list', values: [{ kind: 'empty' }] }));
  });
  it('cycle values', () => {
    expect(f('cycle:current')).toEqual(cmp('cycle', 'eq', str('current')));
    expect(f('cycle:3')).toEqual(cmp('cycle', 'eq', str('3')));
    expect(f('cycle:"Sprint 4"')).toEqual(cmp('cycle', 'eq', str('Sprint 4')));
    expect(f('cycle:empty')).toEqual(cmp('cycle', 'eq', { kind: 'empty' }));
    expect(f('cycle in:next,previous')).toEqual(
      cmp('cycle', 'in', { kind: 'list', values: [str('next'), str('previous')] }),
    );
  });
});

describe('dates', () => {
  it('absolute date', () => {
    expect(f('createdAt gt:2026-01-31')).toEqual(cmp('createdAt', 'gt', { kind: 'date', value: '2026-01-31' }));
  });
  it('ISO timestamps', () => {
    for (const ts of ['2026-01-31T10:00:00Z', '2026-01-31T10:00', '2026-01-31T10:00:00.123Z', '2026-01-31T10:00:00+02:00', '2026-01-31T10:00:00-05:30']) {
      expect(f(`updatedAt lte:${ts}`)).toEqual(cmp('updatedAt', 'lte', { kind: 'date', value: ts }));
    }
  });
  it('timestamp followed by another term', () => {
    expect(f('createdAt gt:2026-01-31T10:00:00Z team:ENG')).toEqual({
      type: 'and',
      children: [cmp('createdAt', 'gt', { kind: 'date', value: '2026-01-31T10:00:00Z' }), cmp('team', 'eq', str('ENG'))],
    });
  });
  it('relative dates', () => {
    const rel = (amount: number, unit: 'd' | 'w' | 'm' | 'y') => ({ kind: 'relativeDate', amount, unit });
    expect(f('createdAt gt:-2w')).toEqual(cmp('createdAt', 'gt', rel(-2, 'w')));
    expect(f('createdAt gt:-7d')).toEqual(cmp('createdAt', 'gt', rel(-7, 'd')));
    expect(f('createdAt gt:-1m')).toEqual(cmp('createdAt', 'gt', rel(-1, 'm')));
    expect(f('createdAt gt:-1y')).toEqual(cmp('createdAt', 'gt', rel(-1, 'y')));
    expect(f('createdAt lt:+3d')).toEqual(cmp('createdAt', 'lt', rel(3, 'd')));
    expect(f('createdAt lt:-12D')).toEqual(cmp('createdAt', 'lt', rel(-12, 'd')));
  });
  it('ISO duration style', () => {
    const rel = (amount: number, unit: 'd' | 'w' | 'm' | 'y') => ({ kind: 'relativeDate', amount, unit });
    expect(f('createdAt gt:-P2W')).toEqual(cmp('createdAt', 'gt', rel(-2, 'w')));
    expect(f('createdAt lt:P3D')).toEqual(cmp('createdAt', 'lt', rel(3, 'd')));
    expect(f('createdAt lt:+P1M')).toEqual(cmp('createdAt', 'lt', rel(1, 'm')));
    expect(f('createdAt gt:-p1y')).toEqual(cmp('createdAt', 'gt', rel(-1, 'y')));
  });
  it('zero is never negative zero', () => {
    const node = f('createdAt gt:-0d');
    expect(node).toEqual(cmp('createdAt', 'gt', { kind: 'relativeDate', amount: 0, unit: 'd' }));
    if (node && node.type === 'cmp' && node.value.kind === 'relativeDate') {
      expect(Object.is(node.value.amount, -0)).toBe(false);
    }
  });
  it('rejects invalid dates', () => {
    for (const bad of ['2026-02-30', '2026-13-01', 'yesterday', '2026-1-1', '-2x', '2w', '-P1H', '2026-01-31T25:00', '2026-01-31T10:61']) {
      expect(err(`createdAt gt:${bad}`).info.position).toBe(13);
    }
  });
  it('leap day', () => {
    expect(() => parseFilter('createdAt:2024-02-29')).not.toThrow();
    expect(() => parseFilter('createdAt:2025-02-29')).toThrow(DslError);
  });
  it('completedAt empty', () => {
    expect(f('completedAt:empty')).toEqual(cmp('completedAt', 'eq', { kind: 'empty' }));
    expect(f('completedAt neq:empty')).toEqual(cmp('completedAt', 'neq', { kind: 'empty' }));
    expect(f('completedAt gt:2026-01-01')).not.toBeNull();
  });
  it('completedAt neq with a date is rejected', () => {
    expect(err('completedAt neq:2026-01-01').info.message).toMatch(/only accepts 'empty'/);
  });
  it('completedAt empty with gt rejected', () => {
    expect(() => parseFilter('completedAt gt:empty')).toThrow(DslError);
  });
  it('createdAt rejects empty', () => {
    expect(() => parseFilter('createdAt:empty')).toThrow(DslError);
  });
  it('createdAt rejects lists', () => {
    expect(() => parseFilter('createdAt:2026-01-01,2026-01-02')).toThrow(DslError);
  });
});

describe('precedence, grouping, implicit and', () => {
  const a = cmp('team', 'eq', str('A'));
  const b = cmp('team', 'eq', str('B'));
  const c = cmp('team', 'eq', str('C'));
  const d = cmp('team', 'eq', str('D'));
  it('implicit and', () => {
    expect(f('team:A team:B')).toEqual({ type: 'and', children: [a, b] });
    expect(f('team:A team:B team:C')).toEqual({ type: 'and', children: [a, b, c] });
  });
  it('explicit and, case-insensitive keywords', () => {
    expect(f('team:A AND team:B')).toEqual({ type: 'and', children: [a, b] });
    expect(f('team:A And team:B and team:C')).toEqual({ type: 'and', children: [a, b, c] });
  });
  it('mixed implicit and explicit and', () => {
    expect(f('team:A and team:B team:C')).toEqual({ type: 'and', children: [a, b, c] });
  });
  it('and binds tighter than or', () => {
    expect(f('team:A or team:B and team:C')).toEqual({ type: 'or', children: [a, { type: 'and', children: [b, c] }] });
    expect(f('team:A and team:B or team:C')).toEqual({ type: 'or', children: [{ type: 'and', children: [a, b] }, c] });
  });
  it('implicit and binds tighter than or', () => {
    expect(f('team:A team:B OR team:C team:D')).toEqual({
      type: 'or',
      children: [
        { type: 'and', children: [a, b] },
        { type: 'and', children: [c, d] },
      ],
    });
  });
  it('or chains are flat', () => {
    expect(f('team:A or team:B or team:C')).toEqual({ type: 'or', children: [a, b, c] });
  });
  it('parentheses override precedence', () => {
    expect(f('(team:A or team:B) and team:C')).toEqual({ type: 'and', children: [{ type: 'or', children: [a, b] }, c] });
    expect(f('team:A and (team:B or team:C)')).toEqual({ type: 'and', children: [a, { type: 'or', children: [b, c] }] });
  });
  it('redundant parentheses collapse', () => {
    expect(f('((team:A))')).toEqual(a);
    expect(f('(team:A and team:B) and team:C')).toEqual({ type: 'and', children: [a, b, c] });
  });
  it('not binds tighter than and', () => {
    expect(f('not team:A team:B')).toEqual({ type: 'and', children: [{ type: 'not', child: a }, b] });
    expect(f('not team:A or team:B')).toEqual({ type: 'or', children: [{ type: 'not', child: a }, b] });
  });
  it('not with group', () => {
    expect(f('not (team:A or team:B)')).toEqual({ type: 'not', child: { type: 'or', children: [a, b] } });
  });
  it('not nesting', () => {
    expect(f('not not team:A')).toEqual({ type: 'not', child: { type: 'not', child: a } });
    expect(f('not (not team:A)')).toEqual({ type: 'not', child: { type: 'not', child: a } });
    expect(f('NOT Not team:A')).toEqual({ type: 'not', child: { type: 'not', child: a } });
  });
  it('and not', () => {
    expect(f('team:A and not team:B')).toEqual({ type: 'and', children: [a, { type: 'not', child: b }] });
  });
  it('parens adjacent to terms', () => {
    expect(f('(team:A)(team:B)')).toEqual({ type: 'and', children: [a, b] });
    expect(f('(team:A)or(team:B)')).toEqual({ type: 'or', children: [a, b] });
  });
  it('deep but legal nesting', () => {
    const src = `${'('.repeat(30)}team:A${')'.repeat(30)}`;
    expect(f(src)).toEqual(a);
  });
  it('too-deep nesting is an error, not a stack overflow', () => {
    expect(() => parseFilter(`${'('.repeat(500)}team:A${')'.repeat(500)}`)).toThrow(DslError);
    expect(() => parseFilter(`${'not '.repeat(500)}team:A`)).toThrow(DslError);
  });
});

describe('is: shorthand', () => {
  const rel = (v: string) => cmp('relations', 'eq', str(v));
  it('desugars', () => {
    expect(f('is:blocked')).toEqual(rel('blockedBy'));
    expect(f('is:blocking')).toEqual(rel('blocks'));
    expect(f('is:duplicate')).toEqual(rel('duplicate'));
    expect(f('is:related')).toEqual(rel('related'));
    expect(f('IS:BLOCKED')).toEqual(rel('blockedBy'));
  });
  it('works with not and and', () => {
    expect(f('not is:blocked')).toEqual({ type: 'not', child: rel('blockedBy') });
    expect(f('is:blocked team:ENG')).toEqual({ type: 'and', children: [rel('blockedBy'), cmp('team', 'eq', str('ENG'))] });
  });
  it('rejects unknown values', () => {
    const e = err('is:happy');
    expect(e.info.position).toBe(3);
  });
  it('rejects lists / ops', () => {
    expect(() => parseFilter('is:blocked,blocking')).toThrow(DslError);
    expect(() => parseFilter('is neq:blocked')).toThrow(DslError);
    expect(() => parseFilter('is:')).toThrow(DslError);
  });
});

describe('order clause', () => {
  it('order only', () => {
    expect(parseFilter('order:priority asc')).toEqual({ filter: null, order: [{ field: 'priority', direction: 'asc' }] });
  });
  it('multiple terms', () => {
    expect(parseFilter('order:priority asc, createdAt desc').order).toEqual([
      { field: 'priority', direction: 'asc' },
      { field: 'createdAt', direction: 'desc' },
    ]);
    expect(parseFilter('order:priority asc,createdAt desc').order).toHaveLength(2);
  });
  it('colon direction', () => {
    expect(parseFilter('order:priority:desc').order).toEqual([{ field: 'priority', direction: 'desc' }]);
    expect(parseFilter('order:priority:asc, title:desc').order).toEqual([
      { field: 'priority', direction: 'asc' },
      { field: 'title', direction: 'desc' },
    ]);
  });
  it('default directions', () => {
    expect(parseFilter('order:createdAt').order[0]?.direction).toBe('desc');
    expect(parseFilter('order:updatedAt').order[0]?.direction).toBe('desc');
    expect(parseFilter('order:completedAt').order[0]?.direction).toBe('desc');
    for (const fld of ['priority', 'status', 'estimate', 'manual', 'title', 'identifier']) {
      expect(parseFilter(`order:${fld}`).order[0]?.direction).toBe('asc');
    }
  });
  it('aliases and case', () => {
    expect(parseFilter('order:created').order).toEqual([{ field: 'createdAt', direction: 'desc' }]);
    expect(parseFilter('ORDER:Updated asc').order).toEqual([{ field: 'updatedAt', direction: 'asc' }]);
    expect(parseFilter('order:completed DESC').order).toEqual([{ field: 'completedAt', direction: 'desc' }]);
  });
  it('mix defaults and explicit', () => {
    expect(parseFilter('order:priority, created').order).toEqual([
      { field: 'priority', direction: 'asc' },
      { field: 'createdAt', direction: 'desc' },
    ]);
  });
  it('after a filter', () => {
    expect(parseFilter('team:ENG order:manual')).toEqual({
      filter: cmp('team', 'eq', str('ENG')),
      order: [{ field: 'manual', direction: 'asc' }],
    });
    expect(parseFilter('team:A or team:B order:title').filter?.type).toBe('or');
  });
  it('SPEC example', () => {
    const q = parseFilter('assignee:me and statusCategory:in_progress and priority lt:2 and not label:bug order:priority asc');
    expect(q).toEqual({
      filter: {
        type: 'and',
        children: [
          cmp('assignee', 'eq', { kind: 'me' }),
          cmp('statusCategory', 'eq', str('in_progress')),
          cmp('priority', 'lt', num(2)),
          { type: 'not', child: cmp('label', 'eq', str('bug')) },
        ],
      },
      order: [{ field: 'priority', direction: 'asc' }],
    });
  });
  it('errors', () => {
    expect(err('order:').info.position).toBe(6);
    expect(err('order:color').info.position).toBe(6);
    expect(err('order:priority asc team:A').info.position).toBe(19);
    expect(err('order:priority up').info.position).toBe(15);
    expect(err('order:priority:up').info.position).toBe(15);
    expect(err('order:priority,').info.position).toBe(15);
    expect(err('order:priority, priority desc').info.message).toMatch(/Duplicate/);
    expect(err('(order:priority)').info.position).toBe(1);
    expect(err('team:A order:priority order:title').info.position).toBe(22);
  });
});
