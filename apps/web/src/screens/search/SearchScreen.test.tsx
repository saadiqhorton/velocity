import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { m } from '@/i18n';
import { SearchScreen } from './SearchScreen';

vi.mock('@apollo/client', () => ({
  useQuery: () => ({ data: { search: [] }, previousData: undefined, loading: false, error: undefined, refetch: () => Promise.resolve() }),
}));
vi.mock('@/app/workspace', () => ({ useWorkspace: () => ({ teamsById: new Map() }) }));
vi.mock('@/lib/navigation', () => ({ useOpenIssue: () => () => undefined, usePanelIssueId: () => null }));

function Where() {
  return <p data-testid="search">{useLocation().search}</p>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/search" element={<SearchScreen />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

describe('Search empty states', () => {
  it('offers Clear search when a query has no results', () => {
    renderAt('/search?q=zzz');
    expect(screen.getByText(m.search.noResults('zzz'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m.search.clearQuery }));
    expect(screen.getByTestId('search').textContent).toBe('?q=');
    expect(screen.getByText(m.search.empty)).toBeTruthy();
  });

  it('hints the / shortcut before any query is typed', () => {
    renderAt('/search');
    expect(screen.getByText(m.search.empty).parentElement?.querySelector('kbd')?.textContent).toBe('/');
  });
});
