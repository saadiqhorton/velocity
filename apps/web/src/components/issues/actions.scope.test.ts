import { describe, expect, it } from 'vitest';
import { listAccepts } from './actions';

const issue = { teamId: 't1', projectId: 'p1', milestoneId: 'm1', cycleId: null, parentId: null };
const list = (milestoneId: string | null) => `issues:${JSON.stringify({ projectId: 'p1', milestoneId })}`;

describe('optimistic inserts into milestone issue lists', () => {
  it('does not insert another milestone or an unassigned issue into the drill-down', () => {
    expect(listAccepts(list('m1'), issue)).toBe(true);
    expect(listAccepts(list('m2'), issue)).toBe(false);
    expect(listAccepts(list('m1'), { ...issue, milestoneId: null })).toBe(false);
  });

  it('still inserts milestone issues into the containing project list', () => {
    expect(listAccepts(list(null), issue)).toBe(true);
  });
});
