import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing';
import { MemoryRouter } from 'react-router-dom';
import { engine } from '@/keyboard/react';
import { targetIssueIds } from '@/lib/targets';
import { useSelection } from '@/stores/selection';
import { useUi } from '@/stores/ui';
import { m } from '@/i18n';
import { CommandPalette } from './CommandPalette';

const actions = vi.hoisted(() => ({
  update: vi.fn<(ids: readonly string[], input: Record<string, unknown>) => Promise<void>>(() => Promise.resolve()),
  move: vi.fn<(ids: readonly string[], teamId: string) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock('@/components/issues/actions', async (orig) => ({
  ...(await orig<typeof import('@/components/issues/actions')>()),
  useUpdateIssues: () => actions.update,
  useMoveIssue: () => actions.move,
}));

const fixtures = vi.hoisted(() => {
  const team = {
    id: 't1',
    key: 'ENG',
    name: 'Engineering',
    cycleEnabled: false,
    estimateScale: 'linear',
    statuses: [
      { id: 's-todo', name: 'Todo', category: 'todo', color: 'gray', order: 0 },
      { id: 's-doing', name: 'In progress', category: 'started', color: 'yellow', order: 1 },
      { id: 's-done', name: 'Done', category: 'done', color: 'green', order: 2 },
    ],
  };
  const labels = [
    { id: 'l-bug', name: 'Bug', color: 'red', isGroup: false, parentId: null, description: null },
    { id: 'l-design', name: 'Design', color: 'blue', isGroup: false, parentId: null, description: null },
  ];
  const row = (id: string, identifier: string, extra: Record<string, unknown> = {}) => ({
    id,
    identifier,
    title: `Issue ${identifier}`,
    teamId: 't1',
    statusId: 's-todo',
    priority: 2,
    assigneeId: null,
    projectId: null,
    cycleId: null,
    estimate: null,
    labelIds: [] as string[],
    ...extra,
  });
  const rows: Record<string, ReturnType<typeof row>> = {
    'issue-1': row('issue-1', 'ENG-1'),
    'issue-2': row('issue-2', 'ENG-2', { statusId: 's-doing' }),
  };
  const ws = {
    viewer: { id: 'u1', name: 'Ada', username: 'ada', avatarUrl: null },
    teams: [team],
    teamsById: new Map([[team.id, team]]),
    labels,
    projects: [],
    views: [],
    activeUsers: [],
  };
  return { ws, rows };
});

vi.mock('@/app/workspace', async (orig) => ({
  ...(await orig<typeof import('@/app/workspace')>()),
  useWorkspace: () => fixtures.ws,
}));

vi.mock('@/lib/issueCache', async (orig) => ({
  ...(await orig<typeof import('@/lib/issueCache')>()),
  readIssueRow: (_cache: unknown, id: string) => fixtures.rows[id] ?? null,
}));

const hasTargets = () => targetIssueIds().length > 0;

let unregister: () => void;

beforeEach(() => {
  unregister = engine.register([
    { id: 'issue.status', title: 'Set status…', group: 'issue', keys: ['s'], icon: 'board', page: 'status', when: hasTargets, run: vi.fn() },
    { id: 'issue.label', title: 'Add label…', group: 'issue', keys: ['l'], page: 'labels', when: hasTargets, run: vi.fn() },
    { id: 'issue.project', title: 'Change project…', group: 'issue', icon: 'project', when: hasTargets, run: vi.fn() },
    { id: 'general.create', title: 'Create issue', group: 'general', keys: ['c'], run: vi.fn() },
    { id: 'nav.inbox', title: 'Go to inbox', group: 'navigation', keys: ['g i'], icon: 'inbox', run: vi.fn() },
  ]);
  useSelection.getState().set(['issue-1']);
  useUi.setState({ paletteOpen: true, paletteMode: '' });
});

afterEach(() => {
  unregister();
  useSelection.getState().clear();
  useUi.setState({ paletteOpen: false });
  actions.update.mockClear();
  actions.move.mockClear();
});

function renderPalette() {
  return render(
    <MockedProvider mocks={[]} addTypename={false}>
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    </MockedProvider>,
  );
}

const input = () => screen.getByRole('combobox');
const options = () => screen.getAllByRole('option').map((o) => o.textContent ?? '');
// Matches on text, not the accessible name: highlighted runs split the label across spans.
const optionNamed = (name: string): HTMLElement => {
  const found = screen.getAllByRole('option').find((o) => o.textContent?.includes(name));
  if (!found) throw new Error(`no option "${name}"`);
  return found;
};

describe('command palette: issue actions and sub-pages', () => {
  it('shows the target chip and lists issue actions before general ones', () => {
    renderPalette();
    expect(screen.getByTestId('palette-target').textContent).toBe('ENG-1');
    const names = options();
    const issueAt = names.findIndex((n) => n.includes('Set status'));
    const generalAt = names.findIndex((n) => n.includes('Create issue'));
    expect(issueAt).toBeGreaterThanOrEqual(0);
    expect(issueAt).toBeLessThan(generalAt);
    expect(screen.getByText(m.palette.issueActions)).toBeTruthy();
  });

  it('counts a multi-selection in the chip', () => {
    useSelection.getState().set(['issue-1', 'issue-2']);
    renderPalette();
    expect(screen.getByTestId('palette-target').textContent).toBe(m.palette.targetCount(2));
  });

  it('renders the command icon instead of the generic one', () => {
    renderPalette();
    expect(optionNamed('Set status').querySelector('[data-icon="board"]')).not.toBeNull();
    expect(optionNamed('Go to inbox').querySelector('[data-icon="inbox"]')).not.toBeNull();
  });

  it('opens the status list, filters it, and applies the pick through the update hook', async () => {
    renderPalette();
    fireEvent.click(optionNamed('Set status'));

    expect(input().getAttribute('placeholder')).toBe('Change status…');
    expect(screen.getByTestId('palette-target').textContent).toBe('ENG-1');
    expect(options()).toEqual(['Todo', 'In progress', 'Done']);
    expect(options().some((o) => o.includes('Create issue'))).toBe(false);

    fireEvent.change(input(), { target: { value: 'done' } });
    expect(options()).toEqual(['Done']);

    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(actions.update).toHaveBeenCalledWith(['issue-1'], { statusId: 's-done' }));
    expect(useUi.getState().paletteOpen).toBe(false);
  });

  it('checks the current value on the sub-page', () => {
    useSelection.getState().set(['issue-2']);
    renderPalette();
    fireEvent.click(optionNamed('Set status'));
    expect(optionNamed('In progress').getAttribute('aria-selected')).toBe('true');
    expect(optionNamed('Done').getAttribute('aria-selected')).toBe('false');
  });

  it('Backspace on an empty sub-page input returns to the root page', () => {
    renderPalette();
    fireEvent.click(optionNamed('Set status'));
    expect(input().getAttribute('placeholder')).toBe('Change status…');

    fireEvent.keyDown(input(), { key: 'Backspace' });
    expect(input().getAttribute('placeholder')).toBe(m.palette.placeholder);
    expect(optionNamed('Set status')).toBeTruthy();
    expect(useUi.getState().paletteOpen).toBe(true);
  });

  it('Esc steps back from a sub-page, and closes the palette from the root', () => {
    renderPalette();
    fireEvent.click(optionNamed('Set status'));

    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().getAttribute('placeholder')).toBe(m.palette.placeholder);
    expect(useUi.getState().paletteOpen).toBe(true);

    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(useUi.getState().paletteOpen).toBe(false);
  });

  it('labels toggle in place and the palette stays open', () => {
    renderPalette();
    fireEvent.click(optionNamed('Add label'));
    expect(input().getAttribute('placeholder')).toBe(m.palette.pageLabels);

    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(actions.update).toHaveBeenLastCalledWith(['issue-1'], { addLabelIds: ['l-bug'] });
    expect(useUi.getState().paletteOpen).toBe(true);
    expect(optionNamed('Bug').getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(actions.update).toHaveBeenLastCalledWith(['issue-1'], { removeLabelIds: ['l-bug'] });
    expect(optionNamed('Bug').getAttribute('aria-selected')).toBe('false');
  });

  it('highlights matched characters of a result title', () => {
    renderPalette();
    fireEvent.change(input(), { target: { value: 'stat' } });
    const row = optionNamed('Set status');
    expect(within(row).getByText('stat').className).toBe('text-fg');
    expect(within(row).getByText(/^Set/).className).toBe('text-fg-subtle');
  });
});
