import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListScreenProps } from '@/components/issues/ListScreen';
import { useUi } from '@/stores/ui';
import { ProjectIssues } from './ProjectIssues';
import type { Milestone } from './ProjectMilestones';

const list = vi.hoisted(() => vi.fn());
vi.mock('@/components/issues/ListScreen', () => ({
  ListScreen: (props: ListScreenProps) => {
    list(props);
    return <>{props.headerExtra}{props.actions}</>;
  },
}));
const milestone = { id: 'm1', name: 'Alpha', status: 'planned', progress: { percent: 50 } } as Milestone;
function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}
function mount(search = '') {
  return render(<MemoryRouter initialEntries={[`/project/p1/issues${search}`]}><Location /><ProjectIssues projectId="p1" projectName="Billing" teamId="t1" milestones={[milestone]} /></MemoryRouter>);
}
beforeEach(() => {
  list.mockClear();
  useUi.setState({ createOpen: false, createDefaults: {} });
});

describe('project milestone issue drill-down', () => {
  it('scopes the server query and newly created issues to the linked milestone', () => {
    mount('?milestone=m1');
    expect(list.mock.lastCall?.[0]).toMatchObject({ title: 'Billing', scope: { projectId: 'p1', milestoneId: 'm1' }, context: { projectId: 'p1', milestoneId: 'm1', teamId: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: 'New issue' }));
    expect(useUi.getState().createDefaults).toMatchObject({ milestoneId: 'm1', projectId: 'p1' });
  });

  it('clears only the milestone scope, keeping other filters and display settings', () => {
    mount('?milestone=m1&filter=priority%3A1&layout=board');
    fireEvent.click(screen.getByRole('button', { name: 'Clear milestone filter: Alpha' }));
    expect(screen.getByTestId('location').textContent).toBe('/project/p1/issues?filter=priority%3A1&layout=board');
    expect(list.mock.lastCall?.[0].scope).toEqual({ projectId: 'p1' });
    expect(screen.queryByRole('button', { name: 'Clear milestone filter: Alpha' })).toBeNull();
  });

  it('rejects stale and foreign milestone links instead of silently showing unfiltered issues', () => {
    mount('?milestone=foreign');
    expect(screen.getByRole('alert').textContent).toContain('This milestone is no longer available');
    expect(list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show all project issues' }));
    expect(list.mock.lastCall?.[0].scope).toEqual({ projectId: 'p1' });
  });
});
