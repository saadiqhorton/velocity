import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '@/i18n';
import { useUi } from '@/stores/ui';
import { Insights } from './Insights';

vi.mock('@apollo/client', () => ({
  useQuery: () => ({ data: { createdVsCompleted: [], velocityByTeam: [] }, loading: false, error: undefined, refetch: () => undefined }),
}));
vi.mock('@/app/workspace', () => ({ useWorkspace: () => ({ teamsById: new Map() }) }));
vi.mock('@/lib/features', () => ({ useFeatures: () => ({ insights: true }) }));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderInsights() {
  render(
    <MemoryRouter initialEntries={['/insights']}>
      <Routes>
        <Route path="/insights" element={<Insights />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Insights empty states', () => {
  beforeEach(() => useUi.setState({ createOpen: false, createDefaults: {} }));

  it('offers New issue when there is no activity', () => {
    renderInsights();
    expect(screen.getByText(m.insights.noData)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m.issue.newIssue }));
    expect(useUi.getState().createOpen).toBe(true);
  });

  it('links to team settings when no team uses cycles', () => {
    renderInsights();
    expect(screen.getByText(m.insights.noCycles)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m.insights.openTeamSettings }));
    expect(screen.getByTestId('where').textContent).toBe('/settings/teams');
  });
});
