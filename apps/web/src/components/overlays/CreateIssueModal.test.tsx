import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing';
import { m } from '@/i18n';
import { useUi } from '@/stores/ui';
import { CreateIssueModal } from './CreateIssueModal';

const { createIssue, showFlag } = vi.hoisted(() => ({
  createIssue: vi.fn(() => Promise.resolve({ data: null })),
  showFlag: vi.fn(() => 'flag-1'),
}));

vi.mock('@velocity/ui', async (orig) => ({
  ...(await orig<typeof import('@velocity/ui')>()),
  useFlags: () => ({ showFlag, dismissFlag: vi.fn() }),
}));

vi.mock('@/app/workspace', () => {
  const viewer = { id: 'u1', name: 'Demo Owner', username: 'demo', avatarUrl: null };
  const team = {
    id: 't1',
    key: 'ENG',
    name: 'Engineering',
    color: 'blue',
    icon: null,
    cycleEnabled: false,
    estimateScale: 'linear',
    statuses: [{ id: 's1', name: 'Todo', category: 'todo', color: 'grey', order: 1, description: null, teamId: 't1' }],
  };
  const projects = [{ id: 'p1', name: 'Billing', color: 'blue', icon: null }, { id: 'p2', name: 'Other project', color: 'blue', icon: null }];
  const ws = {
    viewer,
    teams: [team],
    teamsById: new Map([[team.id, team]]),
    activeUsers: [viewer],
    usersById: new Map([[viewer.id, viewer]]),
    labels: [],
    labelsById: new Map(),
    projects,
    projectsById: new Map(projects.map((project) => [project.id, project])),
  };
  return { useWorkspace: () => ws };
});

vi.mock('@/components/issues/actions', async (orig) => ({
  ...(await orig<typeof import('@/components/issues/actions')>()),
  useCreateIssue: () => [createIssue],
}));

vi.mock('@/lib/navigation', async (orig) => ({
  ...(await orig<typeof import('@/lib/navigation')>()),
  useOpenIssue: () => vi.fn(),
}));

// Only the parent identifier is read from the cache; the real helper needs a full issue row.
vi.mock('@/lib/issueCache', async (orig) => ({
  ...(await orig<typeof import('@/lib/issueCache')>()),
  readIssueRow: (_cache: unknown, id: string) => (id === 'parent-1' ? { identifier: 'ENG-12' } : null),
}));

vi.mock('@/components/editor/LazyEditor', () => ({ LazyEditor: () => null }));

function renderModal() {
  return render(
    <MockedProvider mocks={[]}>
      <CreateIssueModal />
    </MockedProvider>,
  );
}

afterEach(() => {
  useUi.setState({ createDefaults: {} });
  createIssue.mockClear();
});

describe('CreateIssueModal', () => {
  it('preserves the milestone when creating in the project drill-down', () => {
    useUi.setState({ createDefaults: { projectId: 'p1', milestoneId: 'm1' } });
    renderModal();
    fireEvent.change(screen.getByRole('textbox', { name: m.issue.title }), { target: { value: 'Milestone issue' } });
    fireEvent.click(screen.getByTestId('create-issue-submit'));
    expect(createIssue).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', milestoneId: 'm1' }));
  });

  it.each([['Other project', 'p2'], [m.issue.noProject, undefined]])('clears the milestone when selecting %s', (label, projectId) => {
    useUi.setState({ createDefaults: { projectId: 'p1', milestoneId: 'm1' } });
    renderModal();
    fireEvent.change(screen.getByRole('textbox', { name: m.issue.title }), { target: { value: 'Moved out of milestone' } });
    fireEvent.click(screen.getByTestId('create-project'));
    fireEvent.click(screen.getByRole('option', { name: label }));
    fireEvent.click(screen.getByTestId('create-issue-submit'));
    expect(createIssue).toHaveBeenCalledWith(expect.objectContaining({ projectId, milestoneId: undefined }));
  });

  it('renders the team chip and New issue in one header row, with no Cancel button', () => {
    renderModal();
    const header = screen.getByTestId('create-issue-header');
    expect(within(header).getByRole('button', { name: 'Team: ENG' })).toBeTruthy();
    expect(within(header).getByText(m.issue.newIssue)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: m.issue.newIssue })).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.common.cancel })).toBeNull();
    expect(screen.getByTestId('create-issue-submit').textContent).toBe(m.issue.createIssue);
  });

  it('shows an inline title error, keeps focus in the title, and does not create when submitted empty', () => {
    renderModal();
    const title = screen.getByRole('textbox', { name: m.issue.title });
    screen.getByTestId('create-issue-submit').focus();
    fireEvent.click(screen.getByTestId('create-issue-submit'));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(m.issue.titleRequired);
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(title.getAttribute('aria-describedby')).toBe(alert.id);
    expect(document.activeElement).toBe(title);
    expect(createIssue).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: 'Fix login' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(title.getAttribute('aria-invalid')).toBeNull();
  });

  it('shows the parent identifier chip when created as a sub-issue', () => {
    useUi.setState({ createDefaults: { parentId: 'parent-1' } });
    renderModal();
    const chip = screen.getByTestId('create-parent');
    expect(chip.textContent).toBe(m.issue.subIssueOf('ENG-12'));
    expect(within(screen.getByTestId('create-issue-header')).getByText(m.issue.subIssueOf('ENG-12'))).toBeTruthy();
  });

  it('omits the parent chip when the parent is not in the cache', () => {
    useUi.setState({ createDefaults: { parentId: 'missing' } });
    renderModal();
    expect(screen.queryByTestId('create-parent')).toBeNull();
  });

  it('carries the close × in the header row, and it closes the modal', () => {
    useUi.setState({ createOpen: true });
    renderModal();
    fireEvent.click(within(screen.getByTestId('create-issue-header')).getByRole('button', { name: m.common.close }));
    expect(useUi.getState().createOpen).toBe(false);
  });

  it('asks to discard first when the × is clicked with a title typed', () => {
    useUi.setState({ createOpen: true });
    renderModal();
    fireEvent.change(screen.getByRole('textbox', { name: m.issue.title }), { target: { value: 'Half typed' } });
    fireEvent.click(within(screen.getByTestId('create-issue-header')).getByRole('button', { name: m.common.close }));
    expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toBeTruthy();
    expect(useUi.getState().createOpen).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(useUi.getState().createOpen).toBe(false);
  });
});
