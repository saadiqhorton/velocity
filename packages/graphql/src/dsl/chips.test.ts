import { describe, expect, it } from 'vitest';
import type { FilterNode } from '@velocity/schema/filter-ast';
import { FILTER_FIELDS } from '@velocity/schema/filter-ast';
import { FILTER_FIELD_SPECS, fromChips, parseFilter, toChips } from './index';
import type { FilterChip } from './index';

const f = (s: string): FilterNode | null => parseFilter(s).filter;

describe('toChips', () => {
  it('null filter -> empty list', () => {
    expect(toChips(null)).toEqual([]);
  });
  it('single comparison', () => {
    expect(toChips(f('team:ENG'))).toEqual([
      { field: 'team', op: 'eq', value: { kind: 'string', value: 'ENG' }, negated: false },
    ]);
  });
  it('single negated comparison', () => {
    expect(toChips(f('not label:bug'))).toEqual([
      { field: 'label', op: 'eq', value: { kind: 'string', value: 'bug' }, negated: true },
    ]);
  });
  it('and of comparisons and negations', () => {
    const chips = toChips(f('assignee:me priority lt:2 not label:bug'));
    expect(chips).toHaveLength(3);
    expect(chips?.map((c) => c.negated)).toEqual([false, false, true]);
    expect(chips?.map((c) => c.field)).toEqual(['assignee', 'priority', 'label']);
    expect(chips?.[1]?.op).toBe('lt');
  });
  it('lists are preserved', () => {
    const chips = toChips(f('priority in:0,1'));
    expect(chips?.[0]?.value).toEqual({
      kind: 'list',
      values: [
        { kind: 'number', value: 0 },
        { kind: 'number', value: 1 },
      ],
    });
  });
  it('returns null when it contains or', () => {
    expect(toChips(f('team:A or team:B'))).toBeNull();
    expect(toChips(f('team:A and (team:B or team:C)'))).toBeNull();
  });
  it('returns null for not over groups / double not', () => {
    expect(toChips(f('not (team:A and team:B)'))).toBeNull();
    expect(toChips(f('not not team:A'))).toBeNull();
    expect(toChips(f('team:A not (team:B or team:C)'))).toBeNull();
  });
  it('returns null for nested and (hand-built)', () => {
    const a = f('team:A') as FilterNode;
    expect(toChips({ type: 'and', children: [a, { type: 'and', children: [a, a] }] })).toBeNull();
  });
  it('is:blocked becomes a relations chip', () => {
    expect(toChips(f('is:blocked'))).toEqual([
      { field: 'relations', op: 'eq', value: { kind: 'string', value: 'blockedBy' }, negated: false },
    ]);
  });
});

describe('fromChips', () => {
  const chip = (negated: boolean): FilterChip => ({
    field: 'team',
    op: 'eq',
    value: { kind: 'string', value: 'ENG' },
    negated,
  });
  it('empty -> null', () => {
    expect(fromChips([])).toBeNull();
  });
  it('one chip -> bare comparison', () => {
    expect(fromChips([chip(false)])).toEqual({ type: 'cmp', field: 'team', op: 'eq', value: { kind: 'string', value: 'ENG' } });
  });
  it('negated chip -> not', () => {
    expect(fromChips([chip(true)])?.type).toBe('not');
  });
  it('many chips -> and', () => {
    const node = fromChips([chip(false), chip(true)]);
    expect(node?.type).toBe('and');
    expect(node && node.type === 'and' && node.children.map((c) => c.type)).toEqual(['cmp', 'not']);
  });
});

describe('chips <-> AST roundtrip', () => {
  const inputs = [
    '',
    'team:ENG',
    'not label:bug',
    'assignee:me and statusCategory:in_progress and priority lt:2 and not label:bug',
    'status in:"In Progress",Todo createdAt gt:-2w',
    'title contains:"x y" not estimate:empty',
  ];
  for (const input of inputs) {
    it(`AST -> chips -> AST for ${JSON.stringify(input)}`, () => {
      const node = f(input);
      const chips = toChips(node);
      expect(chips).not.toBeNull();
      expect(fromChips(chips ?? [])).toEqual(node);
    });
  }
});

describe('FILTER_FIELD_SPECS', () => {
  it('every field has a label, ops and value kinds', () => {
    for (const field of FILTER_FIELDS) {
      const spec = FILTER_FIELD_SPECS[field];
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.ops).toContain('eq');
      expect(spec.values.length).toBeGreaterThan(0);
    }
  });
  it('enum values', () => {
    expect(FILTER_FIELD_SPECS.statusCategory.enumValues).toEqual(['backlog', 'todo', 'in_progress', 'done', 'canceled']);
    expect(FILTER_FIELD_SPECS.relations.enumValues).toEqual(['blocks', 'blockedBy', 'related', 'duplicate']);
  });
  it('spec examples', () => {
    expect(FILTER_FIELD_SPECS.assignee.values).toEqual(['me', 'empty', 'string']);
    expect(FILTER_FIELD_SPECS.priority.ops).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin']);
    expect(FILTER_FIELD_SPECS.createdAt.ops).toEqual(['eq', 'gt', 'gte', 'lt', 'lte']);
    expect(FILTER_FIELD_SPECS.identifier.ops).toEqual(['eq', 'in']);
  });
});
