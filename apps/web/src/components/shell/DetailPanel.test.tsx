import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DetailPanel } from './DetailPanel';

const nav = vi.hoisted(() => ({ issueId: null as string | null }));

vi.mock('@/lib/navigation', () => ({
  usePanelIssueId: () => nav.issueId,
  useClosePanel: () => () => true,
}));

vi.mock('@/components/issue-detail/IssueDetail', () => ({
  IssueDetail: ({ id }: { id: string }) => <div>issue {id}</div>,
}));

describe('DetailPanel motion', () => {
  afterEach(() => {
    nav.issueId = null;
  });

  it('keeps the panel mounted through its exit animation, then unmounts it', async () => {
    nav.issueId = 'ISS-1';
    const { rerender } = render(<DetailPanel />);
    // Checked before the lazy detail chunk resolves: under load the 200ms enter timer can expire first.
    expect(screen.getByTestId('detail-panel').classList.contains('ds-panel-in')).toBe(true);
    await screen.findByText('issue ISS-1');

    nav.issueId = null;
    rerender(<DetailPanel />);
    const panel = screen.getByTestId('detail-panel');
    expect(panel.classList.contains('ds-panel-out')).toBe(true);
    expect(screen.getByText('issue ISS-1')).toBeTruthy();

    await waitFor(() => expect(screen.queryByTestId('detail-panel')).toBeNull());
  });

  it('switches issues in an open panel without animating the panel', async () => {
    nav.issueId = 'ISS-1';
    const { rerender } = render(<DetailPanel />);
    await screen.findByText('issue ISS-1');
    const panel = screen.getByTestId('detail-panel');
    // The enter animation (200ms) ends and its class is removed.
    await waitFor(() => expect(panel.classList.contains('ds-panel-in')).toBe(false));

    nav.issueId = 'ISS-2';
    rerender(<DetailPanel />);
    expect(screen.getByText('issue ISS-2')).toBeTruthy();
    expect(screen.getByTestId('detail-panel')).toBe(panel);
    expect(panel.className).not.toMatch(/ds-panel-(in|out)/);
  });
});
