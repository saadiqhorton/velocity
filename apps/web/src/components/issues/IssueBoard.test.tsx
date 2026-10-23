import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { IssueRowFieldsFragment } from '@/gql/graphql';
import type { IssueGroup } from '@/lib/grouping';
import { useActiveList } from '@/stores/list';
import { useSelection } from '@/stores/selection';
import type { IssueListResult } from './useIssueList';
import { IssueBoard } from './IssueBoard';

interface Command {
  id: string;
  keys?: readonly string[];
  when?: () => boolean;
  run: () => void;
}

const keyboard = vi.hoisted(() => ({ factory: undefined as (() => unknown[]) | undefined }));
const nav = vi.hoisted(() => ({ openIssue: vi.fn() }));

vi.mock('@/keyboard/react', () => ({
  useCommands: (factory: () => unknown[]) => {
    keyboard.factory = factory;
  },
}));
vi.mock('@/app/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/workspace')>()),
  useWorkspace: () => ({ teams: [], statusesById: new Map(), usersById: new Map(), projectsById: new Map(), teamsById: new Map(), labelsById: new Map(), catalog: { cycles: new Map() } }),
}));
vi.mock('@/lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features')>()),
  useFeatures: () => ({ cycles: true, estimates: true }),
}));
vi.mock('@/lib/navigation', () => ({
  useOpenIssue: () => nav.openIssue,
  useClosePanel: () => () => undefined,
  usePanelIssueId: () => null,
}));
vi.mock('./useIssueDrop', () => ({ useIssueDrop: () => ({ drop: () => undefined }) }));
// jsdom has no layout: render every card so the test can address each one.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 130,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 130 })),
    measureElement: undefined,
    scrollToIndex: () => undefined,
  }),
}));

const issue = (id: string): IssueRowFieldsFragment =>
  ({
    id,
    identifier: `ENG-${id}`,
    title: `Issue ${id}`,
    priority: 0,
    estimate: null,
    assignee: null,
    labels: [],
    status: { id: 's1', name: 'Todo', category: 'unstarted', color: 'grey' },
  }) as unknown as IssueRowFieldsFragment;

// Three columns; reading order is a b | c d | e.
const columns = (): IssueGroup<IssueRowFieldsFragment>[] => [
  { key: 's1', count: 2, unloaded: 0, issues: [issue('a'), issue('b')] },
  { key: 's2', count: 2, unloaded: 0, issues: [issue('c'), issue('d')] },
  { key: 's3', count: 1, unloaded: 0, issues: [issue('e')] },
];

function renderBoard() {
  const groups = columns();
  const issues = groups.flatMap((g) => g.issues);
  const data: IssueListResult = {
    issues,
    groups,
    rows: [],
    total: issues.length,
    loading: false,
    initialLoading: false,
    error: undefined,
    hasMore: false,
    loadingMore: false,
    loadedCount: issues.length,
    ensureLoaded: () => undefined,
    refresh: () => undefined,
    orderTerms: [],
  };
  return render(
    <MemoryRouter>
      <IssueBoard listId="board-test" data={data} grouping="status" empty={null} />
    </MemoryRouter>,
  );
}

const card = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-issue-row="${id}"]`);
  if (!el) throw new Error(`no card ${id}`);
  return el;
};
const selected = () => [...useSelection.getState().selected].sort();
const command = (id: string): Command => {
  const found = (keyboard.factory?.() as Command[] | undefined)?.find((c) => c.id === id);
  if (!found) throw new Error(`no command ${id}`);
  return found;
};

describe('IssueBoard selection matches the list', () => {
  beforeEach(() => {
    useSelection.setState({ selected: new Set(), anchor: null });
    useActiveList.setState({ listId: null, order: [], focusedId: null, context: null });
    nav.openIssue.mockClear();
  });

  it('shift+click selects from the anchor to the card in board reading order, across columns', () => {
    renderBoard();
    fireEvent.click(card('b'), { ctrlKey: true });
    fireEvent.click(card('d'), { shiftKey: true });
    expect(selected()).toEqual(['b', 'c', 'd']);
    expect(nav.openIssue).not.toHaveBeenCalled();
  });

  it('cmd/ctrl+click toggles one card without opening it', () => {
    renderBoard();
    fireEvent.click(card('a'), { metaKey: true });
    fireEvent.click(card('c'), { ctrlKey: true });
    expect(selected()).toEqual(['a', 'c']);
    fireEvent.click(card('a'), { metaKey: true });
    expect(selected()).toEqual(['c']);
    expect(nav.openIssue).not.toHaveBeenCalled();
  });

  it('a plain click still opens the issue', () => {
    renderBoard();
    fireEvent.click(card('a'));
    expect(nav.openIssue.mock.calls[0]?.[0]).toBe('a');
    expect(selected()).toEqual([]);
  });

  it('shift+X selects a range from the anchor to the focused card', () => {
    renderBoard();
    expect(command('board.range').keys).toEqual(['shift+x']);
    expect(command('board.range').when?.()).toBe(false);
    useSelection.getState().toggle('a');
    useActiveList.getState().setFocused('c');
    expect(command('board.range').when?.()).toBe(true);
    command('board.range').run();
    expect(selected()).toEqual(['a', 'b', 'c']);
  });

  it('cmd/ctrl+A selects every card in board order', () => {
    renderBoard();
    const all = command('board.selectAll');
    expect(all.keys).toEqual(['mod+a']);
    expect(all.when?.()).toBe(true);
    all.run();
    expect(selected()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
