import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { m } from '@/i18n';
import { useUi } from '@/stores/ui';
import { Sidebar } from './Sidebar';

const fixtures = vi.hoisted(() => {
  const team = { id: 't1', key: 'ENG', name: 'Engineering', color: 'blue', icon: null, cycleEnabled: false, sortOrder: 0, archivedAt: null, statuses: [] };
  return {
    team,
    ws: {
      viewer: { id: 'u1', name: 'Demo Owner', username: 'demo', avatarUrl: null },
      workspace: null,
      teams: [team],
      teamsById: new Map([[team.id, team]]),
      teamsByKey: new Map([[team.key, team]]),
      users: [],
      activeUsers: [],
      labels: [],
      projects: [],
      favorites: [],
      views: [],
    },
  };
});

vi.mock('@/app/workspace', () => ({ useWorkspace: () => fixtures.ws }));
vi.mock('@/lib/mutation', () => ({ useOptimisticMutation: () => [vi.fn(), {}] }));
vi.mock('@apollo/client', async (orig) => ({
  ...(await orig<typeof import('@apollo/client')>()),
  useQuery: () => ({ data: undefined }),
  useApolloClient: () => ({ clearStore: vi.fn() }),
}));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderSidebar() {
  render(
    <MemoryRouter initialEntries={['/inbox']}>
      <Sidebar />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByRole('button', { name: fixtures.team.name });
}

afterEach(() => useUi.setState({ createOpen: false, createDefaults: {} }));

describe('Sidebar team row actions', () => {
  it('"New issue in" opens the create modal preset to that team and leaves the group open', () => {
    const toggle = renderSidebar();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: m.nav.newIssueIn(fixtures.team.name) }));
    expect(useUi.getState().createOpen).toBe(true);
    expect(useUi.getState().createDefaults).toEqual({ teamId: 't1' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('the team menu offers New issue and Team settings', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: m.nav.teamActions(fixtures.team.name) }));
    fireEvent.click(screen.getByRole('menuitem', { name: m.nav.teamSettings }));
    expect(screen.getByTestId('where').textContent).toBe('/settings/teams/ENG');
  });

  it('the team menu New issue opens the create modal for that team', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: m.nav.teamActions(fixtures.team.name) }));
    fireEvent.click(screen.getByRole('menuitem', { name: m.issue.newIssue }));
    expect(useUi.getState().createDefaults).toEqual({ teamId: 't1' });
  });
});
