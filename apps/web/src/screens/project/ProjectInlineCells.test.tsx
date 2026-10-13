import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { m } from '@/i18n';
import { ProjectHealthCell, ProjectLeadCell, ProjectStatusCell } from './ProjectInlineCells';
import type { ProjectRecord } from './projectUi';

const { save } = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock('@/app/workspace', () => ({
  useWorkspace: () => ({
    activeUsers: [{ id: 'u1', name: 'Demo Owner', username: 'demo', avatarUrl: null }],
    usersById: new Map([['u1', { id: 'u1', name: 'Demo Owner', username: 'demo', avatarUrl: null }]]),
    teams: [],
    teamsById: new Map(),
  }),
}));

vi.mock('./projectUi', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./projectUi')>();
  return { ...mod, useUpdateProject: () => save };
});

const project: ProjectRecord = {
  __typename: 'Project',
  id: 'p1',
  name: 'Billing v2',
  color: 'blue',
  icon: null,
  status: 'planned',
  health: 'on_track',
  targetDate: null,
  leadId: null,
  lead: null,
  archivedAt: null,
  descriptionMd: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  url: '/project/p1',
  teams: [],
  progress: { __typename: 'Progress', done: 2, total: 10, percent: 20, pointsDone: 0, pointsTotal: 0 },
};

describe('ProjectInlineCells', () => {
  it('exposes status, health and lead as in-place listbox triggers', () => {
    render(
      <>
        <ProjectStatusCell project={project} />
        <ProjectHealthCell project={project} />
        <ProjectLeadCell project={project} />
      </>,
    );
    expect(screen.getByTestId('project-cell-status').getAttribute('aria-haspopup')).toBe('listbox');
    expect(screen.getByTestId('project-cell-health').getAttribute('aria-haspopup')).toBe('listbox');
    expect(screen.getByTestId('project-cell-lead').getAttribute('aria-haspopup')).toBe('listbox');
  });

  it('saves a status change from the cell picker without relying on the row click', async () => {
    save.mockClear();
    const onRow = vi.fn();
    render(
      <div role="row" onClick={onRow}>
        <ProjectStatusCell project={project} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('project-cell-status'));
    expect(onRow).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('option', { name: m.project.statuses.in_progress }));
    expect(save).toHaveBeenCalledWith({ status: 'in_progress' });
  });
});
