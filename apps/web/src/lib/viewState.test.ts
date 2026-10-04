import { describe, expect, it } from 'vitest';
import {
  COLUMN_KEYS,
  DEFAULT_COLUMNS,
  DEFAULT_DISPLAY,
  canonicalDsl,
  chipsFromDsl,
  completedClause,
  composeFilter,
  dslFromChips,
  parseViewState,
  writeViewState,
} from './viewState';
import type { DisplayState, ViewState } from './viewState';
import {
  CHIP_FIELDS,
  chipIsNegative,
  chipValues,
  flipChip,
  makeDateChip,
  makeSetChip,
  makeTextChip,
  withValues,
} from './chips';
import type { GroupBy, Ordering } from './grouping';

const defaults: ViewState = { filter: '', display: DEFAULT_DISPLAY };
const q = (s: string): URLSearchParams => new URLSearchParams(s);

describe('parseViewState', () => {
  it('returns defaults for empty params', () => {
    expect(parseViewState(q(''), defaults)).toEqual(defaults);
  });
  it('uses screen defaults, not global ones', () => {
    const d: ViewState = { filter: 'team:ENG', display: { ...DEFAULT_DISPLAY, grouping: 'assignee', layout: 'board' } };
    expect(parseViewState(q(''), d)).toEqual(d);
  });
  it('falls back for invalid values', () => {
    const s = parseViewState(q('group=nope&order=nope&layout=grid&done=maybe&empty=yes&sub=2'), defaults);
    expect(s.display).toEqual(DEFAULT_DISPLAY);
  });
  it('reads valid values', () => {
    const s = parseViewState(
      q('group=label&order=manual&layout=board&done=week&empty=1&sub=false&cols=status,estimate&filter=assignee%3Ame'),
      defaults,
    );
    expect(s).toEqual({
      filter: 'assignee:me',
      display: {
        grouping: 'label',
        ordering: 'manual',
        layout: 'board',
        columns: ['status', 'estimate'],
        showEmptyGroups: true,
        showSubIssues: false,
        showCompleted: 'week',
      },
    });
  });
  it('accepts true/false/1/0 booleans', () => {
    expect(parseViewState(q('empty=true'), defaults).display.showEmptyGroups).toBe(true);
    expect(parseViewState(q('sub=0'), defaults).display.showSubIssues).toBe(false);
  });
  it('drops unknown columns and allows an empty column list', () => {
    expect(parseViewState(q('cols=status,bogus,labels'), defaults).display.columns).toEqual(['status', 'labels']);
    expect(parseViewState(q('cols='), defaults).display.columns).toEqual([]);
  });
  it('an empty filter param overrides a default filter', () => {
    const d: ViewState = { filter: 'team:ENG', display: DEFAULT_DISPLAY };
    expect(parseViewState(q('filter='), d).filter).toBe('');
  });
});

describe('writeViewState', () => {
  it('writes nothing for the defaults', () => {
    expect(writeViewState(defaults, defaults).toString()).toBe('');
  });
  it('writes only the diff', () => {
    const state: ViewState = { filter: 'assignee:me', display: { ...DEFAULT_DISPLAY, grouping: 'priority', showCompleted: 'none' } };
    const p = writeViewState(state, defaults);
    expect([...p.keys()].sort()).toEqual(['done', 'filter', 'group']);
    expect(p.get('group')).toBe('priority');
    expect(p.get('done')).toBe('none');
  });
  it('preserves unrelated params such as issue', () => {
    const base = q('issue=ENG-1&tab=x');
    const p = writeViewState({ ...defaults, display: { ...DEFAULT_DISPLAY, layout: 'board' } }, defaults, base);
    expect(p.get('issue')).toBe('ENG-1');
    expect(p.get('tab')).toBe('x');
    expect(p.get('layout')).toBe('board');
  });
  it('removes view params that return to default but keeps unrelated ones', () => {
    const base = q('issue=ENG-1&group=assignee&filter=team%3AENG');
    const p = writeViewState(defaults, defaults, base);
    expect(p.toString()).toBe('issue=ENG-1');
  });
  it('does not mutate base', () => {
    const base = q('group=assignee');
    writeViewState(defaults, defaults, base);
    expect(base.get('group')).toBe('assignee');
  });
  it('trims and compares the filter against the default filter', () => {
    const d: ViewState = { filter: 'team:ENG', display: DEFAULT_DISPLAY };
    expect(writeViewState({ filter: '  team:ENG ', display: DEFAULT_DISPLAY }, d).has('filter')).toBe(false);
    expect(writeViewState({ filter: '   ', display: DEFAULT_DISPLAY }, defaults).has('filter')).toBe(false);
  });
  // BUG (src/lib/viewState.ts writeViewState/put('filter')): clearing the filter on a screen whose
  // default filter is non-empty writes no `filter` param, so parseViewState falls back to the
  // default filter and the cleared state is lost on reload / shared URL (needs `filter=` written).
  it('round trips a cleared filter when the screen default filter is non-empty', () => {
    const d: ViewState = { filter: 'team:ENG', display: DEFAULT_DISPLAY };
    const state: ViewState = { filter: '', display: DEFAULT_DISPLAY };
    expect(parseViewState(new URLSearchParams(writeViewState(state, d).toString()), d)).toEqual(state);
  });
  it('writes false booleans as 0 when the default is true', () => {
    const p = writeViewState({ ...defaults, display: { ...DEFAULT_DISPLAY, showSubIssues: false } }, defaults);
    expect(p.get('sub')).toBe('0');
  });
});

describe('round trip', () => {
  const groupings: GroupBy[] = ['status', 'assignee', 'priority', 'label', 'project', 'cycle', 'team', 'none'];
  const orderings: Ordering[] = ['priority', 'status', 'created', 'updated', 'estimate', 'manual'];
  const columnSets = [DEFAULT_COLUMNS, [], ['status'], [...COLUMN_KEYS], ['updated', 'created', 'priority']];
  const filters = ['', 'assignee:me', 'status in:"In Progress",Todo createdAt gte:-1w order:updated desc', 'title contains:"a&b=c d"'];

  it('parse(write(state)) === state for many display combos', () => {
    let n = 0;
    for (const grouping of groupings)
      for (const ordering of orderings)
        for (const layout of ['list', 'board'] as const)
          for (const columns of columnSets)
            for (const showCompleted of ['all', 'week', 'none'] as const) {
              const display: DisplayState = {
                grouping,
                ordering,
                layout,
                columns: columns as DisplayState['columns'],
                showEmptyGroups: n % 2 === 0,
                showSubIssues: n % 3 !== 0,
                showCompleted,
              };
              const state: ViewState = { filter: filters[n % filters.length] as string, display };
              expect(parseViewState(writeViewState(state, defaults), defaults)).toEqual(state);
              n++;
            }
    expect(n).toBeGreaterThan(1000);
  });

  it('survives a string round trip through the URL (share by URL)', () => {
    for (const filter of filters) {
      const state: ViewState = {
        filter,
        display: { ...DEFAULT_DISPLAY, grouping: 'cycle', ordering: 'estimate', layout: 'board', columns: ['status', 'cycle'], showCompleted: 'week' },
      };
      const str = writeViewState(state, defaults, q('issue=ENG-4')).toString();
      const back = new URLSearchParams(str);
      expect(parseViewState(back, defaults)).toEqual(state);
      expect(back.get('issue')).toBe('ENG-4');
    }
  });

  it('round trips with non-empty screen defaults', () => {
    const d: ViewState = { filter: 'team:ENG', display: { ...DEFAULT_DISPLAY, grouping: 'assignee', columns: ['status'] } };
    const state: ViewState = { filter: 'team:WEB', display: { ...d.display, grouping: 'status', columns: DEFAULT_COLUMNS } };
    expect(parseViewState(new URLSearchParams(writeViewState(state, d).toString()), d)).toEqual(state);
  });
});

describe('chipsFromDsl / dslFromChips', () => {
  const canonical = [
    'status:Todo',
    'status:"In Progress"',
    'assignee:me',
    'priority:1',
    'priority lt:2',
    'label:bug',
    'project:Apollo',
    'team:ENG',
    'creator:me',
    'createdAt gte:-1w',
    'updatedAt lt:2026-01-31',
    'title contains:"login bug"',
    'not label:bug',
    'status neq:Done',
    'status in:Todo,Backlog',
    'status nin:Todo,Backlog',
    'priority in:0,1,2',
    'label:empty',
    'assignee:me and priority lt:2 and not label:bug',
    'assignee:me and statusCategory:in_progress order:priority asc',
    'team:ENG order:createdAt desc, priority asc',
    'order:updatedAt desc',
  ];
  for (const dsl of canonical) {
    it(`canonical: ${dsl}`, () => {
      const parsed = chipsFromDsl(dsl);
      expect(parsed.error).toBeNull();
      expect(parsed.chips).not.toBeNull();
      expect(dslFromChips(parsed.chips ?? [], parsed.order)).toBe(dsl);
      expect(canonicalDsl(dsl)).toBe(dsl);
    });
  }

  it('canonicalizes loose input', () => {
    expect(canonicalDsl('  TEAM:ENG   created gt:-P2W order:created ')).toBe('team:ENG and createdAt gt:-2w order:createdAt desc');
    const p = chipsFromDsl('priority:urgent');
    expect(dslFromChips(p.chips ?? [])).toBe('priority:0');
  });
  it('empty or whitespace DSL yields no chips and no error', () => {
    expect(chipsFromDsl('')).toEqual({ chips: [], order: [], error: null });
    expect(chipsFromDsl('   ')).toEqual({ chips: [], order: [], error: null });
  });
  it('keeps the order clause separate from chips', () => {
    const p = chipsFromDsl('team:ENG order:priority asc');
    expect(p.chips).toHaveLength(1);
    expect(p.order).toEqual([{ field: 'priority', direction: 'asc' }]);
  });
  it('OR / nested DSL gives chips null without an error', () => {
    for (const dsl of ['team:A or team:B', 'team:A and (team:B or team:C)', 'not (team:A and team:B)']) {
      const p = chipsFromDsl(dsl);
      expect(p.chips, dsl).toBeNull();
      expect(p.error, dsl).toBeNull();
    }
  });
  it('OR DSL is still canonicalized by canonicalDsl', () => {
    expect(canonicalDsl('team:A OR team:B')).toBe('team:A or team:B');
  });
  it('invalid DSL returns an error string', () => {
    for (const dsl of ['status:', 'bogus:1', 'priority lt:', '(team:A', 'team:A and']) {
      const p = chipsFromDsl(dsl);
      expect(p.chips, dsl).toBeNull();
      expect(typeof p.error, dsl).toBe('string');
      expect(p.error?.length, dsl).toBeGreaterThan(0);
    }
  });
  it('canonicalDsl returns trimmed input when it does not parse', () => {
    expect(canonicalDsl('  bogus:1  ')).toBe('bogus:1');
  });
  it('dslFromChips of nothing is empty', () => {
    expect(dslFromChips([])).toBe('');
    expect(dslFromChips([], [{ field: 'priority', direction: 'asc' }])).toBe('order:priority asc');
  });
});

describe('composeFilter', () => {
  it('returns the extras alone for an empty user filter', () => {
    expect(composeFilter('', ['statusCategory nin:done,canceled'])).toBe('(statusCategory nin:done,canceled)');
  });
  it('returns empty when there is nothing to combine', () => {
    expect(composeFilter('', [])).toBe('');
  });
  it('wraps each part in parentheses joined by and', () => {
    expect(composeFilter('assignee:me', ['team:ENG', 'priority lt:2'])).toBe('(assignee:me) and (team:ENG) and (priority lt:2)');
  });
  it('keeps the order clause last', () => {
    const out = composeFilter('assignee:me order:updated desc', ['team:ENG']);
    expect(out).toBe('(assignee:me) and (team:ENG) order:updatedAt desc');
    expect(out.trim().endsWith('order:updatedAt desc')).toBe(true);
  });
  it('supports an order-only user filter', () => {
    expect(composeFilter('order:priority', ['team:ENG'])).toBe('(team:ENG) order:priority asc');
    expect(composeFilter('order:priority', [])).toBe('order:priority asc');
  });
  it('parenthesization keeps OR semantics intact', () => {
    const out = composeFilter('team:A or team:B', ['priority lt:2']);
    expect(out).toBe('(team:A or team:B) and (priority lt:2)');
    expect(chipsFromDsl(out).error).toBeNull();
  });
  it('the completed clause with OR composes correctly', () => {
    const extra = completedClause('week');
    expect(extra).not.toBeNull();
    const out = composeFilter('assignee:me', [extra as string]);
    expect(out).toBe('(assignee:me) and (statusCategory nin:done,canceled or completedAt gte:-1w)');
    expect(chipsFromDsl(out).error).toBeNull();
  });
  it('ignores blank extras', () => {
    expect(composeFilter('team:A', ['', '  '])).toBe('(team:A)');
  });
  it('passes invalid user DSL through unchanged', () => {
    expect(composeFilter('bogus:1 and', ['team:ENG'])).toBe('bogus:1 and');
  });
});

describe('completedClause', () => {
  it('maps each option', () => {
    expect(completedClause('all')).toBeNull();
    expect(completedClause('none')).toBe('statusCategory nin:done,canceled');
    expect(completedClause('week')).toBe('statusCategory nin:done,canceled or completedAt gte:-1w');
  });
  it('emits parseable DSL', () => {
    for (const s of ['none', 'week'] as const) expect(chipsFromDsl(completedClause(s) as string).error).toBeNull();
  });
});

describe('chip helpers', () => {
  it('makeSetChip: eq vs in, neq vs nin', () => {
    expect(makeSetChip('status', ['Todo'])).toEqual({ field: 'status', op: 'eq', value: { kind: 'string', value: 'Todo' }, negated: false });
    expect(makeSetChip('status', ['Todo'], true)?.op).toBe('neq');
    expect(makeSetChip('status', ['Todo', 'Done'])?.op).toBe('in');
    expect(makeSetChip('status', ['Todo', 'Done'], true)?.op).toBe('nin');
    expect(makeSetChip('status', ['Todo', 'Done'])?.value).toEqual({
      kind: 'list',
      values: [
        { kind: 'string', value: 'Todo' },
        { kind: 'string', value: 'Done' },
      ],
    });
  });
  it('makeSetChip: empty values give null', () => {
    expect(makeSetChip('status', [])).toBeNull();
    expect(makeSetChip('status', [], true)).toBeNull();
  });
  it('makeSetChip coerces me, empty and numbers by field', () => {
    expect(makeSetChip('assignee', ['me'])?.value).toEqual({ kind: 'me' });
    expect(makeSetChip('creator', ['me'])?.value).toEqual({ kind: 'me' });
    expect(makeSetChip('label', ['me'])?.value).toEqual({ kind: 'string', value: 'me' });
    expect(makeSetChip('label', ['empty'])?.value).toEqual({ kind: 'empty' });
    expect(makeSetChip('priority', ['2'])?.value).toEqual({ kind: 'number', value: 2 });
    expect(makeSetChip('estimate', ['3'])?.value).toEqual({ kind: 'number', value: 3 });
  });
  it('makeDateChip', () => {
    expect(makeDateChip('createdAt', '-1w', 'after')).toEqual({
      field: 'createdAt',
      op: 'gte',
      value: { kind: 'relativeDate', amount: -1, unit: 'w' },
      negated: false,
    });
    expect(makeDateChip('updatedAt', '2026-01-31', 'before')).toEqual({
      field: 'updatedAt',
      op: 'lt',
      value: { kind: 'date', value: '2026-01-31' },
      negated: false,
    });
    expect(makeDateChip('createdAt', '+3d', 'after').value).toEqual({ kind: 'relativeDate', amount: 3, unit: 'd' });
    expect(dslFromChips([makeDateChip('createdAt', '-1w', 'after')])).toBe('createdAt gte:-1w');
    expect(dslFromChips([makeDateChip('createdAt', '-1m', 'before')])).toBe('createdAt lt:-1m');
  });
  it('makeTextChip', () => {
    const c = makeTextChip('title', 'login bug');
    expect(c).toEqual({ field: 'title', op: 'contains', value: { kind: 'string', value: 'login bug' }, negated: false });
    expect(dslFromChips([c])).toBe('title contains:"login bug"');
  });
  it('chipValues renders strings, numbers, relative dates, me and empty', () => {
    expect(chipValues(makeSetChip('priority', ['1', '2']) as never)).toEqual(['1', '2']);
    expect(chipValues(makeSetChip('assignee', ['me']) as never)).toEqual(['me']);
    expect(chipValues(makeSetChip('label', ['empty']) as never)).toEqual(['empty']);
    expect(chipValues(makeDateChip('createdAt', '-2w', 'after'))).toEqual(['-2w']);
    expect(chipValues(makeDateChip('createdAt', '+3d', 'after'))).toEqual(['+3d']);
    expect(chipValues(makeDateChip('createdAt', '2026-01-31', 'after'))).toEqual(['2026-01-31']);
  });
  it('chipIsNegative honours op and negated', () => {
    expect(chipIsNegative({ field: 'label', op: 'eq', value: { kind: 'string', value: 'a' }, negated: false })).toBe(false);
    expect(chipIsNegative({ field: 'label', op: 'neq', value: { kind: 'string', value: 'a' }, negated: false })).toBe(true);
    expect(chipIsNegative({ field: 'label', op: 'nin', value: { kind: 'list', values: [] }, negated: false })).toBe(true);
    expect(chipIsNegative({ field: 'label', op: 'eq', value: { kind: 'string', value: 'a' }, negated: true })).toBe(true);
    expect(chipIsNegative({ field: 'label', op: 'neq', value: { kind: 'string', value: 'a' }, negated: true })).toBe(false);
  });
  it('flipChip flips sets in both directions', () => {
    const is = makeSetChip('status', ['Todo']) as NonNullable<ReturnType<typeof makeSetChip>>;
    const not = flipChip(is);
    expect(not.op).toBe('neq');
    expect(flipChip(not)).toEqual(is);
    const many = makeSetChip('status', ['Todo', 'Done']) as NonNullable<ReturnType<typeof makeSetChip>>;
    expect(flipChip(many).op).toBe('nin');
    expect(flipChip(flipChip(many))).toEqual(many);
    expect(dslFromChips([flipChip(is)])).toBe('status neq:Todo');
  });
  it('flipChip on a negated chip makes it positive', () => {
    const parsed = chipsFromDsl('not label:bug').chips ?? [];
    const flipped = flipChip(parsed[0] as never);
    expect(chipIsNegative(flipped)).toBe(false);
    expect(dslFromChips([flipped])).toBe('label:bug');
  });
  it('flipChip flips dates after <-> before', () => {
    const after = makeDateChip('createdAt', '-1w', 'after');
    const before = flipChip(after);
    expect(before.op).toBe('lt');
    expect(flipChip(before).op).toBe('gte');
    expect(flipChip({ ...after, op: 'gt' }).op).toBe('lt');
    expect(before.value).toEqual(after.value);
  });
  it('withValues keeps polarity', () => {
    const neg = makeSetChip('label', ['a'], true) as NonNullable<ReturnType<typeof makeSetChip>>;
    expect(withValues(neg, ['a', 'b'])?.op).toBe('nin');
    expect(withValues(neg, ['b'])?.op).toBe('neq');
    const pos = makeSetChip('label', ['a']) as NonNullable<ReturnType<typeof makeSetChip>>;
    expect(withValues(pos, ['a', 'b'])?.op).toBe('in');
    expect(withValues(pos, [])).toBeNull();
  });
  it('withValues keeps polarity of a negated (not) chip', () => {
    const parsed = chipsFromDsl('not label:bug').chips ?? [];
    const next = withValues(parsed[0] as never, ['a']);
    expect(next && chipIsNegative(next)).toBe(true);
  });
  it('every CHIP_FIELD can build a set chip that serializes and reparses', () => {
    for (const f of CHIP_FIELDS) {
      if (f === 'createdAt' || f === 'updatedAt' || f === 'completedAt' || f === 'title') continue;
      const value = f === 'priority' || f === 'estimate' ? '2' : f === 'statusCategory' ? 'done' : 'x';
      const chip = makeSetChip(f, [value]);
      const dsl = dslFromChips(chip ? [chip] : []);
      const back = chipsFromDsl(dsl);
      expect(back.error, `${f}: ${dsl}`).toBeNull();
      expect(dslFromChips(back.chips ?? [])).toBe(dsl);
    }
  });
});
