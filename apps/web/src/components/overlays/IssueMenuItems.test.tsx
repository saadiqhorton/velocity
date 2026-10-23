import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Icon, Menu } from '@velocity/ui';
import type { IssueRowFieldsFragment, TeamFieldsFragment } from '@/gql/graphql';
import type { WorkspaceData } from '@/app/workspace';
import { engine } from '@/keyboard/react';
import { useUi } from '@/stores/ui';
import { IssueMenuItems } from './IssueMenuItems';
import { PickerHost } from './PickerHost';

const h = vi.hoisted(() => ({
  ws: null as unknown as WorkspaceData,
  row: null as IssueRowFieldsFragment | null,
  subscribed: undefined as boolean | undefined,
  update: vi.fn(),
  move: vi.fn(),
  archive: vi.fn(),
  duplicate: vi.fn(),
  setSubscribed: vi.fn(),
  navigate: vi.fn(),
  ai: { copyPrompt: vi.fn(), copyBranch: vi.fn(), copyId: vi.fn(), copyLink: vi.fn(), launch: vi.fn() },
}));

vi.mock('@/app/workspace', () => ({ useWorkspace: () => h.ws }));
vi.mock('@/lib/issueCache', async (orig) => ({ ...(await orig<typeof import('@/lib/issueCache')>()), readIssueRow: () => h.row }));
vi.mock('@/components/issues/actions', () => ({
  useUpdateIssues: () => h.update,
  useMoveIssue: () => h.move,
  useArchiveIssues: () => h.archive,
  useDuplicateIssue: () => h.duplicate,
  useSetSubscribed: () => h.setSubscribed,
}));
vi.mock('@/components/issues/useIssueAi', () => ({
  useIssueAi: () => h.ai,
  issueLink: (id: string) => `https://velocity.test/issue/${id}`,
}));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => h.navigate }));
// The menu reads `subscribed` from the cached issue detail; the pickers' cycle query has no cached result here.
vi.mock('@apollo/client', async (orig) => ({
  ...(await orig<typeof import('@apollo/client')>()),
  useApolloClient: () => ({ cache: {}, readQuery: () => (h.subscribed === undefined ? null : { issue: { subscribed: h.subscribed } }) }),
  useQuery: () => ({ data: undefined }),
}));

const team = {
  id: 'team-eng',
  key: 'ENG',
  name: 'Engineering',
  color: 'blue',
  icon: null,
  cycleEnabled: true,
  estimateScale: 'linear',
  sortOrder: 0,
  archivedAt: null,
  statuses: [
    { id: 'st-todo', name: 'Todo', category: 'todo', color: 'gray', order: 0 },
    { id: 'st-prog', name: 'In progress', category: 'in_progress', color: 'blue', order: 0 },
    { id: 'st-done', name: 'Done', category: 'done', color: 'green', order: 0 },
  ],
} as unknown as TeamFieldsFragment;

function workspace(features: Record<string, boolean> = {}): WorkspaceData {
  return {
    viewer: { id: 'me', name: 'Me', username: 'me', avatarUrl: null },
    workspace: { features: { cycles: true, estimates: true, insights: true, members: true, ...features } },
    teams: [team],
    teamsById: new Map([[team.id, team]]),
    activeUsers: [],
    labels: [{ id: 'l-bug', name: 'Bug', color: 'red', isGroup: false, parentId: null, description: null }],
    labelsById: new Map(),
    projects: [],
    projectsById: new Map(),
  } as unknown as WorkspaceData;
}

const baseRow = {
  id: 'i1',
  identifier: 'ENG-1',
  title: 'Fix it',
  teamId: team.id,
  statusId: 'st-todo',
  status: { id: 'st-todo', name: 'Todo', category: 'todo', color: 'gray', order: 0 },
  priority: 2,
  assigneeId: null,
  projectId: null,
  cycleId: null,
  estimate: null,
  labelIds: [],
} as unknown as IssueRowFieldsFragment;

function renderMenu(onAction = vi.fn(), issueIds = ['i1']) {
  return render(
    <Menu aria-label="Issue actions">
      <IssueMenuItems issueIds={issueIds} onAction={onAction} />
    </Menu>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.ws = workspace();
  h.row = { ...baseRow, labelIds: [] };
  h.subscribed = undefined;
  // Mirror the cache: a label write changes what later toggles see.
  h.update.mockImplementation((_ids: string[], input: { addLabelIds?: string[]; removeLabelIds?: string[] }) => {
    if (h.row) h.row = { ...h.row, labelIds: [...h.row.labelIds.filter((id) => !(input.removeLabelIds ?? []).includes(id)), ...(input.addLabelIds ?? [])] };
    return Promise.resolve();
  });
});

afterEach(() => {
  useUi.setState({ picker: null });
  vi.restoreAllMocks();
});

describe('IssueMenuItems property submenus', () => {
  it('offers the property submenus, and hides Cycle and Estimate when their features are off', () => {
    const first = renderMenu();
    for (const name of ['Status', 'Priority', 'Assignee', 'Labels', 'Project', 'Cycle', 'Estimate']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
    first.unmount();

    h.ws = workspace({ cycles: false, estimates: false });
    renderMenu();
    expect(screen.queryByRole('menuitem', { name: /^Cycle/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Estimate/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /^Status/ })).toBeTruthy();
  });

  it('checks the current status, then applies a choice and closes the menu', () => {
    const onAction = vi.fn();
    renderMenu(onAction);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Status/ }));
    expect(screen.getByRole('option', { name: /^Todo/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: /^In progress/ }));
    expect(h.update).toHaveBeenCalledWith(['i1'], { statusId: 'st-prog' });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('applies a priority from its number key, where 1 is Urgent', () => {
    const onAction = vi.fn();
    renderMenu(onAction);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Priority/ }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: '1' });
    expect(h.update).toHaveBeenCalledWith(['i1'], { priority: 0 });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('toggles labels in place and keeps the menu open', () => {
    const onAction = vi.fn();
    renderMenu(onAction);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Labels/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Bug' }));
    expect(h.update).toHaveBeenLastCalledWith(['i1'], { addLabelIds: ['l-bug'], removeLabelIds: [] });
    expect(screen.getByRole('option', { name: 'Bug' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: 'Bug' }));
    expect(h.update).toHaveBeenLastCalledWith(['i1'], { addLabelIds: [], removeLabelIds: ['l-bug'] });
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('applies a status from the S popup with the same options and commit', () => {
    useUi.setState({ picker: { kind: 'status', issueIds: ['i1'], anchor: null } });
    render(<PickerHost />);
    fireEvent.click(screen.getByRole('option', { name: /^Done/ }));
    expect(h.update).toHaveBeenCalledWith(['i1'], { statusId: 'st-done' });
  });
});

describe('IssueMenuItems status icon', () => {
  const statusIcon = () => screen.getByRole('menuitem', { name: /^Status/ }).querySelector('svg');

  it('shows the single target\'s own status glyph, not the lightning bolt', () => {
    h.row = { ...baseRow, status: { id: 'st-done', name: 'Done', category: 'done', color: 'green', order: 2 } } as IssueRowFieldsFragment;
    renderMenu();
    expect(statusIcon()?.getAttribute('data-status')).toBe('done');
  });

  it('shows the neutral dashed circle when several issues are targeted', () => {
    renderMenu(vi.fn(), ['i1', 'i2']);
    const backlog = render(<Icon name="backlog" />).container.querySelector('svg');
    expect(statusIcon()?.hasAttribute('data-status')).toBe(false);
    expect(statusIcon()?.outerHTML).toBe(backlog?.outerHTML);
  });
});

describe('IssueMenuItems subscribe and open-in', () => {
  it('offers Subscribe when the issue is cached as unsubscribed, and applies it', () => {
    h.subscribed = false;
    renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Subscribe' }));
    expect(h.setSubscribed).toHaveBeenCalledWith({ id: 'i1', subscribed: true });
  });

  it('offers Unsubscribe when subscribed, and hides both when the state is not cached', () => {
    h.subscribed = true;
    const first = renderMenu();
    expect(screen.getByRole('menuitem', { name: 'Unsubscribe' })).toBeTruthy();
    first.unmount();

    h.subscribed = undefined;
    renderMenu();
    expect(screen.queryByRole('menuitem', { name: /subscribe/i })).toBeNull();
  });

  it('opens the issue page in a new tab from the Open in submenu', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const onAction = vi.fn();
    renderMenu(onAction);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in new tab' }));
    expect(open).toHaveBeenCalledWith('https://velocity.test/issue/i1', '_blank', 'noopener');
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('IssueMenuItems shortcut hints', () => {
  it('reads each hint from the command registry, not from a constant in the menu', () => {
    const unregister = engine.register([{ id: 'issue.status', title: 'Set status', group: 'issue', keys: ['x'], run: () => undefined }]);
    try {
      renderMenu();
      expect(within(screen.getByRole('menuitem', { name: /^Status/ })).getByText('X')).toBeTruthy();
      expect(within(screen.getByRole('menuitem', { name: /^Priority/ })).queryByText('P')).toBeNull();
    } finally {
      unregister();
    }
  });
});
