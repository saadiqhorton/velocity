import { describe, expect, it } from 'vitest';
import type { TeamFieldsFragment } from '@/gql/graphql';
import { priorityOptions, statusOptions } from './pickers';

describe('priorityOptions', () => {
  it('numbers the options in display order, so 1 is the first real priority (Urgent)', () => {
    expect(priorityOptions().map((o) => [o.label, o.value, o.shortcut])).toEqual([
      ['No priority', '4', '0'],
      ['Urgent', '0', '1'],
      ['High', '1', '2'],
      ['Medium', '2', '3'],
      ['Low', '3', '4'],
    ]);
  });
});

describe('statusOptions', () => {
  it('numbers the first nine statuses in display order and leaves the rest unnumbered', () => {
    const statuses = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, category: 'todo', color: 'gray', order: 9 - i }));
    const team = { statuses } as unknown as Pick<TeamFieldsFragment, 'statuses'>;
    const options = statusOptions(team);
    expect(options.map((o) => o.label)).toEqual(['S9', 'S8', 'S7', 'S6', 'S5', 'S4', 'S3', 'S2', 'S1', 'S0']);
    expect(options.slice(0, 9).map((o) => o.shortcut)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(options[9]?.shortcut).toBeUndefined();
  });
});
