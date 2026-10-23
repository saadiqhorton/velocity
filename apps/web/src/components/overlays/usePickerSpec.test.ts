import { describe, expect, it, vi } from 'vitest';
import type { IssueRowFieldsFragment, TeamFieldsFragment } from '@/gql/graphql';
import { applyStatus } from './usePickerSpec';

type Status = { id: string; name: string; category: string };

function team(id: string, key: string, statuses: Status[]): TeamFieldsFragment {
  return {
    id,
    key,
    statuses: statuses.map((s, order) => ({ ...s, color: 'gray', order, description: null, teamId: id })),
  } as unknown as TeamFieldsFragment;
}

const eng = team('eng', 'ENG', [
  { id: 'eng-todo', name: 'Todo', category: 'todo' },
  { id: 'eng-prog', name: 'In progress', category: 'started' },
  { id: 'eng-done', name: 'Done', category: 'done' },
]);
// No status named like ENG's: other teams fall back to the same category.
const ops = team('ops', 'OPS', [
  { id: 'ops-open', name: 'Open', category: 'todo' },
  { id: 'ops-wip', name: 'Doing', category: 'started' },
  { id: 'ops-complete', name: 'Complete', category: 'done' },
]);
// Same name as ENG's Todo, plus a different todo-category status: the name wins.
const web = team('web', 'WEB', [
  { id: 'web-backlog', name: 'Backlog', category: 'todo' },
  { id: 'web-todo', name: 'todo', category: 'todo' },
]);

const teamsById = new Map([eng, ops, web].map((t) => [t.id, t]));

function row(id: string, teamId: string): IssueRowFieldsFragment {
  return { id, teamId } as unknown as IssueRowFieldsFragment;
}

describe('applyStatus', () => {
  it('applies the picked status to the team it belongs to, and the matching status in other teams', () => {
    const update = vi.fn(() => Promise.resolve());
    const rows = [row('a', 'eng'), row('b', 'eng'), row('c', 'ops')];
    applyStatus(teamsById, rows, eng, 'eng-done', update);
    expect(update).toHaveBeenCalledWith(['a', 'b'], { statusId: 'eng-done' });
    expect(update).toHaveBeenCalledWith(['c'], { statusId: 'ops-complete' });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('prefers a status with the same name over one with the same category', () => {
    const update = vi.fn(() => Promise.resolve());
    applyStatus(teamsById, [row('a', 'eng'), row('d', 'web')], eng, 'eng-todo', update);
    expect(update).toHaveBeenCalledWith(['d'], { statusId: 'web-todo' });
  });

  it('skips a team with no matching name or category', () => {
    const update = vi.fn(() => Promise.resolve());
    const noDone = team('nodone', 'NOD', [{ id: 'nd-todo', name: 'Todo', category: 'todo' }]);
    applyStatus(new Map([...teamsById, [noDone.id, noDone]]), [row('a', 'eng'), row('e', 'nodone')], eng, 'eng-done', update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(['a'], { statusId: 'eng-done' });
  });

  it('does nothing for a status the picked team does not have', () => {
    const update = vi.fn(() => Promise.resolve());
    applyStatus(teamsById, [row('a', 'eng')], eng, 'ops-complete', update);
    expect(update).not.toHaveBeenCalled();
  });
});
