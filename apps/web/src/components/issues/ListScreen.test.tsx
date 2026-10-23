import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { DEFAULT_DISPLAY } from '@/lib/viewState';
import type { ViewState } from '@/lib/viewState';
import { useSelection } from '@/stores/selection';
import { ListScreen } from './ListScreen';
import type { ListScreenProps } from './ListScreen';

const spy = vi.hoisted(() => ({ board: vi.fn(), list: vi.fn() }));
const result = vi.hoisted(() => ({
  issues: [],
  groups: [],
  rows: [],
  total: 0,
  loading: false,
  initialLoading: false,
  error: undefined,
  hasMore: false,
  loadingMore: false,
  loadedCount: 0,
  ensureLoaded: () => undefined,
  refresh: () => undefined,
  orderTerms: [],
}));
const ws = vi.hoisted(() => ({ teams: [], statusesById: new Map(), usersById: new Map(), projectsById: new Map(), teamsById: new Map(), labelsById: new Map(), catalog: { cycles: new Map() } }));

vi.mock('@/app/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/workspace')>()),
  useWorkspace: () => ws,
}));
vi.mock('@/lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features')>()),
  useFeatures: () => ({ cycles: true, estimates: true }),
}));
vi.mock('@/keyboard/react', () => ({ useCommands: () => undefined }));
vi.mock('./useIssueList', () => ({ useIssueList: () => result }));
vi.mock('./IssueBoard', () => ({
  IssueBoard: (props: unknown) => {
    spy.board(props);
    return null;
  },
}));
vi.mock('./IssueList', () => ({
  IssueList: (props: unknown) => {
    spy.list(props);
    return null;
  },
}));
vi.mock('@/components/shell/ViewHeader', () => ({ ViewHeader: () => null }));
vi.mock('@/components/filters/FilterBar', () => ({ FilterBar: () => null }));
vi.mock('@/components/filters/DisplayOptions', () => ({ DisplayOptions: () => null }));

const view = (ordering: ViewState['display']['ordering'], layout: ViewState['display']['layout'] = 'board'): ViewState => ({
  filter: '',
  display: { ...DEFAULT_DISPLAY, ordering, layout },
});

const base: ListScreenProps = {
  listId: 'team-eng',
  title: 'Team issues',
  scope: { teamId: 't-eng' },
  defaults: view('manual'),
};

function Go({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go
    </button>
  );
}

const tree = (over: Partial<ListScreenProps> = {}, path = '/team/eng/issues') => (
  <MemoryRouter initialEntries={[path]}>
    <Go to="/team/ops/issues" />
    <ListScreen {...base} {...over} />
  </MemoryRouter>
);

const selected = () => [...useSelection.getState().selected].sort();

describe('ListScreen reorderable prop', () => {
  beforeEach(() => {
    spy.board.mockClear();
    spy.list.mockClear();
  });

  it('passes reorderable to the board under manual ordering', () => {
    render(tree({ reorderable: true }));
    expect(spy.board.mock.lastCall?.[0]).toMatchObject({ reorderable: true, grouping: 'status' });
  });

  it('keeps the board read-only for other orderings or screens that are not reorderable', () => {
    const { unmount } = render(tree({ reorderable: true, defaults: view('priority') }));
    expect(spy.board.mock.lastCall?.[0]).toMatchObject({ reorderable: false });
    unmount();
    render(tree({ reorderable: false }));
    expect(spy.board.mock.lastCall?.[0]).toMatchObject({ reorderable: false });
  });

  it('gives the list the same flag under manual ordering', () => {
    render(tree({ reorderable: true, defaults: view('manual', 'list') }));
    expect(spy.list.mock.lastCall?.[0]).toMatchObject({ reorderable: true });
  });
});

describe('ListScreen selection is scoped to its view', () => {
  beforeEach(() => {
    useSelection.setState({ selected: new Set(), anchor: null });
  });

  it('clears the selection when the route changes', () => {
    render(tree());
    useSelection.getState().set(['a', 'b']);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(selected()).toEqual([]);
  });

  it('clears the selection when the list changes', () => {
    const { rerender } = render(tree());
    useSelection.getState().set(['a']);
    rerender(tree({ listId: 'team-ops', scope: { teamId: 't-ops' } }));
    expect(selected()).toEqual([]);
  });

  it('keeps the selection while the view is unchanged, even with a fresh scope object', () => {
    const { rerender } = render(tree());
    useSelection.getState().set(['a']);
    rerender(tree({ scope: { teamId: 't-eng' } }));
    expect(selected()).toEqual(['a']);
  });

  it('clears the selection when the screen unmounts', () => {
    const { unmount } = render(tree());
    useSelection.getState().set(['a']);
    unmount();
    expect(selected()).toEqual([]);
  });
});
