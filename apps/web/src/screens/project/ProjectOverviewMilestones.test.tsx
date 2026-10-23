import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '@/i18n';
import { ProjectOverviewMilestones } from './ProjectOverviewMilestones';
import type { Milestone } from './ProjectMilestones';

const actions = vi.hoisted(() => ({ patch: vi.fn(), remove: vi.fn(), moveTo: vi.fn() }));
vi.mock('./ProjectMilestones', async (original) => ({
  ...(await original<typeof import('./ProjectMilestones')>()),
  useMilestoneActions: () => actions,
}));

const alpha: Milestone = {
  __typename: 'Milestone', id: 'm1', projectId: 'p1', name: 'Alpha', description: 'Protect the existing workflows.',
  status: 'planned', sortOrder: 1000, targetDate: null,
  progress: { __typename: 'Progress', total: 4, done: 3, percent: 75, pointsDone: 0, pointsTotal: 0 },
};
const beta: Milestone = { ...alpha, id: 'm2', name: 'Beta', description: null, sortOrder: 2000 };
const mount = () => render(<MemoryRouter><ProjectOverviewMilestones projectId="p1" milestones={[beta, alpha]} /></MemoryRouter>);

beforeEach(() => vi.clearAllMocks());

describe('overview milestone document rows', () => {
  it('orders milestones and exposes descriptions and separate issue drill-down links', () => {
    mount();
    const rows = screen.getAllByTestId('overview-milestone');
    expect(within(rows[0]!).getByRole('button', { name: 'Status: Alpha, Planned' })).toBeTruthy();
    expect(screen.getByText(alpha.description!)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View issues in Alpha' }).getAttribute('href')).toBe('/project/p1/issues?milestone=m1');
    expect(screen.getByRole('link', { name: 'View issues in Beta' }).getAttribute('href')).toBe('/project/p1/issues?milestone=m2');
  });

  it('updates status from the name dropdown', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Status: Alpha, Planned' }));
    fireEvent.click(screen.getByRole('option', { name: 'In progress' }));
    expect(actions.patch).toHaveBeenCalledWith('m1', { status: 'in_progress' });
  });

  it('makes current description and target-date values available to assistive technology', () => {
    render(<MemoryRouter><ProjectOverviewMilestones projectId="p1" milestones={[{ ...alpha, targetDate: '2026-12-15' }]} /></MemoryRouter>);
    const description = screen.getByRole('button', { name: 'Description: Alpha' });
    expect(document.getElementById(description.getAttribute('aria-describedby')!)?.textContent).toBe(alpha.description);
    const date = screen.getByRole('button', { name: 'Target date: Alpha' });
    expect(document.getElementById(date.getAttribute('aria-describedby')!)?.textContent).toContain('Dec 15');
  });

  it('saves a description on blur and leaves an Escape-canceled edit unchanged', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Description: Alpha' }));
    const editor = screen.getByRole('textbox', { name: 'Description: Alpha' });
    fireEvent.change(editor, { target: { value: 'New release criteria.' } });
    fireEvent.blur(editor);
    expect(actions.patch).toHaveBeenCalledWith('m1', { description: 'New release criteria.' });

    actions.patch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Description: Alpha' }));
    const canceled = screen.getByRole('textbox', { name: 'Description: Alpha' });
    fireEvent.change(canceled, { target: { value: 'Discard me' } });
    fireEvent.keyDown(canceled, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Description: Alpha' })).toBeNull();
    expect(actions.patch).not.toHaveBeenCalled();
  });

  it('clears a description and edits a target date through the existing mutation action', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Description: Alpha' }));
    const editor = screen.getByRole('textbox', { name: 'Description: Alpha' });
    fireEvent.change(editor, { target: { value: '  ' } });
    fireEvent.blur(editor);
    expect(actions.patch).toHaveBeenCalledWith('m1', { description: null });

    fireEvent.click(screen.getByRole('button', { name: 'Target date: Alpha' }));
    fireEvent.change(screen.getByLabelText('Target date: Alpha'), { target: { value: '2026-12-15' } });
    expect(actions.patch).toHaveBeenCalledWith('m1', { targetDate: '2026-12-15' });
  });

  it('offers keyboard-accessible reordering and requires confirmation before deleting', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }));
    expect(screen.getByRole('menuitem', { name: m.project.moveUp }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: m.project.moveDown }));
    expect(actions.moveTo).toHaveBeenCalledWith('m1', 1);

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha' }));
    fireEvent.click(screen.getByRole('menuitem', { name: m.common.delete }));
    expect(actions.remove).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: m.common.delete }));
    expect(actions.remove).toHaveBeenCalledWith('m1');
  });

  it('moves a dragged milestone to the hovered row', () => {
    mount();
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(screen.getByRole('button', { name: 'Drag to reorder: Alpha' }), { dataTransfer });
    const target = screen.getAllByTestId('overview-milestone')[1]!;
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(actions.moveTo).toHaveBeenCalledWith('m1', 1);
  });
});
