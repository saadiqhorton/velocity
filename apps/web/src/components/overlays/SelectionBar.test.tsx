import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { m } from '@/i18n';
import { useSelection } from '@/stores/selection';
import { SelectionBar } from './SelectionBar';

vi.mock('@/lib/features', () => ({ useFeatures: () => ({ cycles: false }) }));
vi.mock('@/components/issues/actions', () => ({ useArchiveIssues: () => () => Promise.resolve() }));

describe('SelectionBar motion', () => {
  afterEach(() => {
    act(() => useSelection.getState().clear());
  });

  it('rises in on the first selection and keeps its count while it rises out', async () => {
    render(<SelectionBar />);
    expect(screen.queryByTestId('selection-bar')).toBeNull();

    act(() => useSelection.getState().set(['a', 'b']));
    const bar = screen.getByTestId('selection-bar');
    expect(bar.classList.contains('ds-rise-in')).toBe(true);
    expect(bar.textContent).toContain(m.issue.selectedCount(2));

    act(() => useSelection.getState().clear());
    const exiting = screen.getByTestId('selection-bar');
    expect(exiting.classList.contains('ds-rise-out')).toBe(true);
    // The count must not flash to zero during the exit.
    expect(exiting.textContent).toContain(m.issue.selectedCount(2));

    await waitFor(() => expect(screen.queryByTestId('selection-bar')).toBeNull());
  });
});
