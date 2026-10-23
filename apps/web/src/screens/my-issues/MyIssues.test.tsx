import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '@/i18n';
import { useUi } from '@/stores/ui';
import { MyIssues } from './MyIssues';

vi.mock('@/app/workspace', () => ({ useWorkspace: () => ({ viewer: { id: 'viewer-1' } }) }));
// Render only the empty slot: the list itself is covered elsewhere.
vi.mock('@/components/issues/ListScreen', () => ({ ListScreen: ({ empty }: { empty: ReactNode }) => <>{empty}</> }));

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/my-issues" element={<MyIssues />} />
        <Route path="/my-issues/:preset" element={<MyIssues />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('My issues empty state', () => {
  beforeEach(() => useUi.setState({ createOpen: false, createDefaults: {} }));

  it('offers New issue assigned to the viewer on the Open preset', () => {
    renderAt('/my-issues');
    expect(screen.getByText(m.list.emptyMine)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m.issue.newIssue }));
    expect(useUi.getState().createOpen).toBe(true);
    expect(useUi.getState().createDefaults).toEqual({ assigneeId: 'viewer-1' });
  });

  it('offers New issue without an assignee on the Created preset', () => {
    renderAt('/my-issues/created');
    expect(screen.getByText(m.myIssues.emptyCreated)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m.issue.newIssue }));
    expect(useUi.getState().createDefaults).toEqual({});
  });
});
