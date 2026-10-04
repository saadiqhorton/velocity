import { describe, expect, it } from 'vitest';
import { parseFilter, serializeFilter } from './index';

const canon = (s: string): string => serializeFilter(parseFilter(s));

describe('serializeFilter canonical output', () => {
  const cases: [string, string][] = [
    ['', ''],
    ['team:ENG', 'team:ENG'],
    ['  TEAM:ENG  ', 'team:ENG'],
    ['statuscategory:DONE', 'statusCategory:done'],
    ['priority lt:2', 'priority lt:2'],
    ['priority:urgent', 'priority:0'],
    ['priority in:0,1,2', 'priority in:0,1,2'],
    ['priority in:high', 'priority in:1'],
    ['status in:"In Progress",Todo', 'status in:"In Progress",Todo'],
    ['status:"Done"', 'status:Done'],
    ['title contains:"login bug"', 'title contains:"login bug"'],
    ['title:"a\\"b"', 'title:"a\\"b"'],
    ['title:"a\\\\b"', 'title:"a\\\\b"'],
    ['title:""', 'title:""'],
    ['assignee:ME', 'assignee:me'],
    ['assignee:"me"', 'assignee:"me"'],
    ['label:"EMPTY"', 'label:"EMPTY"'],
    ['label:Empty', 'label:empty'],
    ['createdAt gt:-2w', 'createdAt gt:-2w'],
    ['created gt:-P2W', 'createdAt gt:-2w'],
    ['created lt:P3D', 'createdAt lt:+3d'],
    ['createdAt gt:2026-01-31', 'createdAt gt:2026-01-31'],
    ['updatedAt lte:2026-01-31T10:00:00Z', 'updatedAt lte:2026-01-31T10:00:00Z'],
    ['identifier:eng-12', 'identifier:ENG-12'],
    ['is:blocked', 'relations:blockedBy'],
    ['is:blocking', 'relations:blocks'],
    ['not is:duplicate', 'not relations:duplicate'],
    ['team:A team:B', 'team:A and team:B'],
    ['team:A AND team:B', 'team:A and team:B'],
    ['team:A OR team:B', 'team:A or team:B'],
    ['team:A or team:B team:C', 'team:A or team:B and team:C'],
    ['(team:A or team:B) team:C', '(team:A or team:B) and team:C'],
    ['(team:A and team:B) or team:C', 'team:A and team:B or team:C'],
    ['not (team:A or team:B)', 'not (team:A or team:B)'],
    ['not (team:A and team:B)', 'not (team:A and team:B)'],
    ['not not team:A', 'not not team:A'],
    ['not (not team:A)', 'not not team:A'],
    ['((team:A))', 'team:A'],
    ['order:priority', 'order:priority asc'],
    ['order:created', 'order:createdAt desc'],
    ['order:priority:desc', 'order:priority desc'],
    ['team:A order:priority asc,created desc', 'team:A order:priority asc, createdAt desc'],
    [
      'assignee:me and statusCategory:in_progress and priority lt:2 and not label:bug order:priority asc',
      'assignee:me and statusCategory:in_progress and priority lt:2 and not label:bug order:priority asc',
    ],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      expect(canon(input)).toBe(expected);
    });
  }

  it('serializes a hand-built nested AST with parentheses', () => {
    const a = { type: 'cmp', field: 'team', op: 'eq', value: { kind: 'string', value: 'A' } } as const;
    const b = { ...a, value: { kind: 'string', value: 'B' } } as const;
    const out = serializeFilter({
      filter: { type: 'and', children: [a, { type: 'and', children: [a, b] }] },
      order: [],
    });
    expect(out).toBe('team:A and (team:A and team:B)');
  });
  it('quotes strings that would be ambiguous', () => {
    const out = serializeFilter({
      filter: {
        type: 'cmp',
        field: 'label',
        op: 'in',
        value: {
          kind: 'list',
          values: [
            { kind: 'string', value: 'me' },
            { kind: 'string', value: 'a b' },
            { kind: 'string', value: 'x:y' },
            { kind: 'string', value: 'p,q' },
            { kind: 'string', value: 'plain' },
          ],
        },
      },
      order: [],
    });
    expect(out).toBe('label in:"me","a b","x:y","p,q",plain');
    expect(parseFilter(out).filter).toMatchObject({ value: { values: [{ value: 'me' }, { value: 'a b' }, { value: 'x:y' }, { value: 'p,q' }, { value: 'plain' }] } });
  });
});
