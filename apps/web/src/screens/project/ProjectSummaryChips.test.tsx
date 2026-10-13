import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { m } from '@/i18n';
import { ProjectSummaryChips } from './ProjectSummaryChips';
import type { ProjectRecord } from './projectUi';

vi.mock('@/app/workspace', () => ({
  useWorkspace: () => ({
    activeUsers: [{ id: 'u1', name: 'Demo Owner', username: 'demo', avatarUrl: null }],
    teams: [{ id: 't1', key: 'ENG', name: 'Engineering', color: 'blue', icon: null }],
    teamsById: new Map([['t1', { id: 't1', key: 'ENG', name: 'Engineering', color: 'blue', icon: null }]]),
  }),
}));

const project: ProjectRecord = {
  __typename: 'Project',
  id: 'p1',
  name: 'Billing v2',
  color: 'blue',
  icon: null,
  status: 'planned',
  health: 'on_track',
  targetDate: '2026-12-22',
  leadId: null,
  lead: null,
  archivedAt: null,
  descriptionMd: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  url: '/project/p1',
  teams: [{ __typename: 'Team', id: 't1', key: 'ENG', name: 'Engineering' }],
  progress: { __typename: 'Progress', done: 0, total: 0, percent: 0, pointsDone: 0, pointsTotal: 0 },
};

describe('ProjectSummaryChips', () => {
  it('exposes each property as an editable control, not plain text', () => {
    render(<ProjectSummaryChips project={project} save={vi.fn()} />);
    const summary = screen.getByTestId('project-summary');
    for (const name of [
      `${m.project.status}: ${m.project.statuses.planned}`,
      `${m.project.health}: ${m.project.healths.on_track}`,
      `${m.project.lead}: ${m.project.noLead}`,
      `${m.project.teams}: Engineering`,
    ]) {
      expect(within(summary).getByRole('button', { name }).getAttribute('aria-haspopup')).toBe('listbox');
    }
    expect(within(summary).getByRole('button', { name: new RegExp(`^${m.project.targetDate}:`) })).toBeTruthy();
  });

  it('saves a status change from the summary chip picker', async () => {
    const save = vi.fn();
    render(<ProjectSummaryChips project={project} save={save} />);
    fireEvent.click(screen.getByRole('button', { name: `${m.project.status}: ${m.project.statuses.planned}` }));
    const option = await screen.findByRole('option', { name: m.project.statuses.in_progress });
    fireEvent.click(option);
    expect(save).toHaveBeenCalledWith({ status: 'in_progress' });
  });
});
