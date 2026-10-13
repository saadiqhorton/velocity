import { describe, expect, it } from 'vitest';
import { layout } from '@velocity/tokens';
import { ROW_HEIGHT } from './IssueList';

describe('issue list geometry', () => {
  // The virtualizer positions rows by ROW_HEIGHT with no measurement, so it must match the
  // token the row CSS is drawn to; a mismatch overlaps rows or leaves gaps.
  it('virtual row height equals the issue-row token', () => {
    expect(ROW_HEIGHT).toBe(layout.issueRowHeight);
  });
});
