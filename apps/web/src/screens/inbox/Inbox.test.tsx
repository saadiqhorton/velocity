import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { FlagProvider } from '@velocity/ui';
import { m } from '@/i18n';
import { Inbox } from './Inbox';

vi.mock('@apollo/client', () => ({
  useQuery: () => ({ data: { notifications: [], unreadNotificationCount: 0 }, loading: false, error: undefined, refetch: () => undefined }),
}));
vi.mock('@/lib/mutation', () => ({ asArray: (v: unknown) => v, useOptimisticMutation: () => [() => Promise.resolve({})] }));
vi.mock('@/keyboard/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/keyboard/react')>();
  return { ...mod, useCommands: () => undefined };
});
vi.mock('@/lib/navigation', () => ({ useOpenIssue: () => () => undefined, usePanelIssueId: () => null }));

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderAt(path: string) {
  render(
    <FlagProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/inbox" element={<Inbox />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </FlagProvider>,
  );
}

describe('Inbox empty states', () => {
  it('offers Show all from a filtered preset and returns to the full inbox', () => {
    renderAt('/inbox?preset=unread');
    expect(screen.getByText(m.inbox.emptyPreset.unread)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m.inbox.showAll }));
    expect(screen.getByText(m.inbox.emptyPreset.all)).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('/inbox');
  });

  it('offers a way to all issues when the inbox is caught up', () => {
    renderAt('/inbox');
    expect(screen.getByText(m.inbox.emptyPreset.all)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m.cmd.goAll }));
    expect(screen.getByTestId('where').textContent).toBe('/issues');
  });
});
