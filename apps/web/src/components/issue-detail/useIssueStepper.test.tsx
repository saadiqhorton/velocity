import type { PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { IssueListResult } from '@/components/issues/useIssueList';
import { DEFAULT_DISPLAY } from '@/lib/viewState';
import { useIssueList } from '@/components/issues/useIssueList';
import { useIssueStepper } from './useIssueStepper';

vi.mock('@/app/workspace', () => ({
  useWorkspace: () => ({ workspace: null, teamsById: new Map() }),
}));
vi.mock('@/components/issues/useIssueList', () => ({ useIssueList: vi.fn() }));

const issue = { id: 'target', teamId: 'team' };
const source = {
  listId: 'long-list',
  label: 'Long list',
  returnTo: '/team/ENG/active',
  params: { scope: { teamId: 'team' }, filter: '', display: DEFAULT_DISPLAY, collapsed: [] },
};
const wrapper = ({ children }: PropsWithChildren) => (
  <MemoryRouter initialEntries={[{ pathname: '/issue/ENG-1501', state: { issueNav: { source, depth: 0 } } }]}>{children}</MemoryRouter>
);

function list(length: number, hasMore: boolean, ensureLoaded: ReturnType<typeof vi.fn>): IssueListResult {
  const rows = Array.from({ length }, (_, i) => ({
    type: 'issue' as const,
    issue: { id: i === 1500 ? issue.id : `issue-${i}`, identifier: `ENG-${i + 1}` },
  }));
  return {
    rows,
    groups: [],
    total: 2500,
    hasMore,
    loadedCount: length,
    ensureLoaded,
  } as unknown as IssueListResult;
}

describe('long issue list stepper', () => {
  it('loads past issue 1,000, then exposes the correct position and neighbors', async () => {
    const ensureLoaded = vi.fn();
    const data = vi.mocked(useIssueList);
    data.mockReturnValue(list(1000, true, ensureLoaded));
    const { result, rerender } = renderHook(() => useIssueStepper(issue), { wrapper });

    await waitFor(() => expect(ensureLoaded).toHaveBeenCalledWith(1999));
    expect(result.current.position).toBeNull();

    data.mockReturnValue(list(2000, true, ensureLoaded));
    rerender();
    expect(result.current.position).toBe(1501);
    expect(result.current.total).toBe(2500);
    expect(result.current.canPrev).toBe(true);
    expect(result.current.canNext).toBe(true);
    expect(ensureLoaded).toHaveBeenCalledTimes(1);
  });
});
