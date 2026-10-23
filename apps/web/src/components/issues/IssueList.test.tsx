import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_DISPLAY } from '@/lib/viewState';
import type { IssueListResult } from './useIssueList';
import { IssueList } from './IssueList';

vi.mock('@/app/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/workspace')>()),
  useWorkspace: () => ({ statusesById: new Map(), usersById: new Map(), projectsById: new Map(), teamsById: new Map(), labelsById: new Map() }),
}));
vi.mock('@/keyboard/react', () => ({ useCommands: () => undefined }));
vi.mock('@/lib/navigation', () => ({
  useOpenIssue: () => () => undefined,
  useClosePanel: () => () => undefined,
  usePanelIssueId: () => null,
}));
vi.mock('@/components/shell/ShellSkeleton', () => ({ ContentSkeleton: () => null }));
vi.mock('./useIssueDrop', () => ({ useIssueDrop: () => ({ drop: () => undefined, reorder: () => undefined }) }));
vi.mock('./IssueRow', () => ({
  IssueRow: ({ issue }: { issue: { identifier: string } }) => <div>{issue.identifier}</div>,
  PlaceholderRow: () => null,
}));
vi.mock('./GroupHeader', () => ({
  groupInfo: (_grouping: unknown, key: string | null) => ({ label: String(key), icon: null, defaults: {} }),
  GroupHeader: ({ info, dropTarget }: { info: { label: string }; dropTarget?: boolean }) => (
    <div data-testid={`header-${info.label}`} data-drop-target={String(Boolean(dropTarget))} />
  ),
}));

function issue(id: string) {
  return { id, identifier: id.toUpperCase(), title: `Issue ${id}` };
}

/** Two groups: `todo` (sticky header at the top) and `done`. */
function listData(): IssueListResult {
  const rows = [
    { type: 'header', key: 'todo', count: 2, collapsed: false },
    { type: 'issue', issue: issue('a1'), groupKey: 'todo' },
    { type: 'issue', issue: issue('a2'), groupKey: 'todo' },
    { type: 'header', key: 'done', count: 1, collapsed: false },
    { type: 'issue', issue: issue('b1'), groupKey: 'done' },
  ];
  return {
    issues: rows.flatMap((r) => (r.type === 'issue' ? [r.issue] : [])),
    groups: [],
    rows,
    total: 3,
    loading: false,
    initialLoading: false,
    error: undefined,
    hasMore: false,
    loadingMore: false,
    loadedCount: 3,
    ensureLoaded: () => undefined,
    refresh: () => undefined,
    orderTerms: [],
  } as unknown as IssueListResult;
}

/** The virtualizer needs a non-zero scroll viewport to lay out rows in jsdom. */
function stubViewport() {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
}

function renderList() {
  return render(
    <MemoryRouter>
      <IssueList
        listId="test"
        data={listData()}
        display={{ ...DEFAULT_DISPLAY, grouping: 'status' }}
        onToggleGroup={() => undefined}
        empty={null}
        reorderable
      />
    </MemoryRouter>,
  );
}

/** The absolutely positioned slot wrapper of a row or header (it carries `data-index`). */
function slotOf(text: string): HTMLElement {
  // Scoped to the list: a drag preview lingers in the body until its next tick.
  const el = within(screen.getByTestId('issue-list')).getByText(text).closest<HTMLElement>('[data-index]');
  if (!el) throw new Error(`no slot for ${text}`);
  return el;
}

const glides = (text: string) => slotOf(text).classList.contains('issue-row-glide');

function dragTransfer() {
  return { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: 'uninitialized' };
}

describe('IssueList row glide', () => {
  beforeEach(() => stubViewport());

  it('lets issue rows glide on a reorder, but not the sticky header', () => {
    renderList();
    expect(glides('A1')).toBe(true);
    expect(glides('A2')).toBe(true);
    expect(glides('B1')).toBe(true);
    // The top header is stuck to the viewport: its transform changes type when it stops sticking.
    expect(screen.getByTestId('header-todo').closest('[data-index]')?.classList.contains('issue-row-glide')).toBe(false);
  });

  it('turns the glide off for the duration of a drag and back on when it ends', () => {
    renderList();
    fireEvent.dragStart(within(screen.getByTestId('issue-list')).getByText('A2'), { dataTransfer: dragTransfer() });
    expect(glides('A1')).toBe(false);
    expect(glides('B1')).toBe(false);

    fireEvent.dragEnd(within(screen.getByTestId('issue-list')).getByText('A2'));
    expect(glides('A1')).toBe(true);
  });

  it('marks the group under the pointer as the drop target of its header', () => {
    renderList();
    expect(screen.getByTestId('header-done').getAttribute('data-drop-target')).toBe('false');

    fireEvent.dragStart(within(screen.getByTestId('issue-list')).getByText('A2'), { dataTransfer: dragTransfer() });
    fireEvent.dragOver(slotOf('B1'));
    expect(screen.getByTestId('header-done').getAttribute('data-drop-target')).toBe('true');
    expect(screen.getByTestId('header-todo').getAttribute('data-drop-target')).toBe('false');
  });
});
