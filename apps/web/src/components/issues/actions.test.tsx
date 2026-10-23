import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArchiveIssuesDocument,
  BulkUpdateIssuesDocument,
  SetIssueSubscribedDocument,
  ToggleIssueDoneDocument,
  TrashIssuesDocument,
  UpdateIssueDocument,
} from '@/gql/graphql';
import type { IssueRowFieldsFragment } from '@/gql/graphql';
import { latestUndo, resetUndo, undoDepth } from '@/lib/undo';
import { m } from '@/i18n';
import { useArchiveIssues, useSetSubscribed, useToggleDone, useTrashIssues, useUpdateIssues } from './actions';

/** Shared mock state: rows and statuses stand in for the Apollo cache; `run` stands in for every mutation. */
const h = vi.hoisted(() => ({
  rows: new Map<string, IssueRowFieldsFragment>(),
  statuses: new Map<string, { id: string; name: string; category: string; order: number }>(),
  teamsById: new Map<string, unknown>(),
  contracts: new Map<unknown, unknown>(),
  run: vi.fn<(document: unknown, vars: unknown) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: {}, error: null })),
  showFlag: vi.fn<(flag: unknown) => string>(() => 'flag-1'),
}));

vi.mock('@velocity/ui', async (orig) => ({
  ...(await orig<typeof import('@velocity/ui')>()),
  useFlags: () => ({ showFlag: h.showFlag, dismissFlag: vi.fn() }),
}));

vi.mock('@/lib/mutation', async (orig) => ({
  ...(await orig<typeof import('@/lib/mutation')>()),
  useOptimisticMutation: (document: unknown, contract: unknown) => {
    h.contracts.set(document, contract);
    return [(vars: unknown) => h.run(document, vars), { loading: false }];
  },
}));

vi.mock('@/lib/issueCache', async (orig) => ({
  ...(await orig<typeof import('@/lib/issueCache')>()),
  readIssueRow: (_cache: unknown, id: string) => h.rows.get(id) ?? null,
  readStatus: (_cache: unknown, id: string) => h.statuses.get(id) ?? null,
}));

vi.mock('@/app/workspace', () => ({
  useWorkspace: () => ({ teamsById: h.teamsById, teams: [], viewer: { id: 'me' } }),
}));

const STATUSES = [
  { id: 'backlog', name: 'Backlog', category: 'backlog', order: 0 },
  { id: 'todo', name: 'Todo', category: 'todo', order: 1 },
  { id: 'ip', name: 'In Progress', category: 'started', order: 2 },
  { id: 'done', name: 'Done', category: 'done', order: 3 },
];

function issue(id: string, over: Partial<IssueRowFieldsFragment> = {}): IssueRowFieldsFragment {
  const status = STATUSES.find((s) => s.id === (over.statusId ?? 'todo')) ?? STATUSES[1];
  return {
    __typename: 'Issue',
    id,
    identifier: `ENG-${id.slice(1)}`,
    number: 1,
    title: 'Issue',
    priority: 2,
    estimate: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    completedAt: null,
    archivedAt: null,
    trashedAt: null,
    teamId: 'team',
    statusId: status?.id ?? 'todo',
    assigneeId: null,
    projectId: null,
    cycleId: null,
    milestoneId: null,
    parentId: null,
    labelIds: [],
    commentCount: 0,
    status: { __typename: 'WorkflowStatus', ...status, color: 'gray', description: null, teamId: 'team' },
    assignee: null,
    labels: [],
    cycle: null,
    subIssueRollup: { __typename: 'SubIssueRollup', done: 0, total: 0 },
    ...over,
  } as IssueRowFieldsFragment;
}

function Wrapper({ children }: { children: ReactNode }) {
  return <MockedProvider mocks={[]}>{children}</MockedProvider>;
}

beforeEach(() => {
  resetUndo();
  h.run.mockClear();
  h.showFlag.mockClear();
  h.rows.clear();
  h.statuses.clear();
  for (const s of STATUSES) h.statuses.set(s.id, s);
  h.teamsById.clear();
  h.teamsById.set('team', { id: 'team', key: 'ENG', statuses: STATUSES.map((s) => ({ ...s, color: 'gray', description: null, teamId: 'team' })) });
});

describe('useUpdateIssues undo', () => {
  it('a single change pushes an entry capturing the previous value, and undo writes that value back', async () => {
    h.rows.set('i1', issue('i1', { statusId: 'todo' }));
    const { result } = renderHook(() => useUpdateIssues(), { wrapper: Wrapper });
    await act(async () => {
      await result.current(['i1'], { statusId: 'ip' });
    });
    expect(h.run).toHaveBeenCalledWith(UpdateIssueDocument, { id: 'i1', input: { statusId: 'ip' } });
    expect(undoDepth()).toBe(1);
    expect(latestUndo()?.label).toBe(m.undo.change.status);

    await act(async () => {
      await latestUndo()?.undo();
    });
    expect(h.run).toHaveBeenLastCalledWith(UpdateIssueDocument, { id: 'i1', input: { statusId: 'todo' } });
  });

  it('a single change is silent: no flag, the undo is only reachable from the stack', async () => {
    h.rows.set('i1', issue('i1'));
    const { result } = renderHook(() => useUpdateIssues(), { wrapper: Wrapper });
    await act(async () => {
      await result.current(['i1'], { priority: 0 });
    });
    expect(h.showFlag).not.toHaveBeenCalled();
    expect(undoDepth()).toBe(1);
  });

  it('a rejected change leaves no entry behind', async () => {
    h.rows.set('i1', issue('i1'));
    h.run.mockResolvedValueOnce({ data: null, error: { code: 'VALIDATION' } });
    const { result } = renderHook(() => useUpdateIssues(), { wrapper: Wrapper });
    await act(async () => {
      await result.current(['i1'], { priority: 0 });
    });
    expect(undoDepth()).toBe(0);
  });

  it('a bulk change confirms with a flag whose Undo restores each issue to its own previous status', async () => {
    h.rows.set('i1', issue('i1', { statusId: 'todo' }));
    h.rows.set('i2', issue('i2', { statusId: 'backlog' }));
    h.rows.set('i3', issue('i3', { statusId: 'todo' }));
    const { result } = renderHook(() => useUpdateIssues(), { wrapper: Wrapper });
    await act(async () => {
      await result.current(['i1', 'i2', 'i3'], { statusId: 'ip' });
    });
    expect(h.run).toHaveBeenCalledWith(BulkUpdateIssuesDocument, { ids: ['i1', 'i2', 'i3'], input: { statusId: 'ip' } });
    expect(h.showFlag).toHaveBeenCalledWith(expect.objectContaining({ title: '3 issues moved to In Progress', severity: 'success' }));

    const flag = h.showFlag.mock.calls[0]?.[0] as { action?: { label: string; onClick: () => void } };
    expect(flag.action?.label).toBe('Undo');
    await act(async () => {
      flag.action?.onClick();
    });
    await waitFor(() => expect(h.run).toHaveBeenCalledWith(BulkUpdateIssuesDocument, { ids: ['i1', 'i3'], input: { statusId: 'todo' } }));
    expect(h.run).toHaveBeenCalledWith(UpdateIssueDocument, { id: 'i2', input: { statusId: 'backlog' } });
    expect(undoDepth()).toBe(0);
  });
});

describe('useToggleDone', () => {
  it('E on one issue confirms "ENG-1 marked Done" with an Undo that reopens it', async () => {
    h.rows.set('i1', issue('i1', { statusId: 'todo', identifier: 'ENG-123' }));
    const { result } = renderHook(() => useToggleDone(), { wrapper: Wrapper });
    await act(async () => {
      await result.current(['i1']);
    });
    expect(h.run).toHaveBeenCalledWith(ToggleIssueDoneDocument, { id: 'i1' });
    expect(h.showFlag).toHaveBeenCalledWith(expect.objectContaining({ title: 'ENG-123 marked Done', severity: 'success' }));

    const flag = h.showFlag.mock.calls[0]?.[0] as { action?: { onClick: () => void } };
    await act(async () => {
      flag.action?.onClick();
    });
    await waitFor(() => expect(h.run).toHaveBeenCalledWith(UpdateIssueDocument, { id: 'i1', input: { statusId: 'todo' } }));
  });

  it('E on a done issue confirms "ENG-123 reopened"', async () => {
    h.rows.set('i1', issue('i1', { statusId: 'done', identifier: 'ENG-123' }));
    const { result } = renderHook(() => useToggleDone(), { wrapper: Wrapper });
    await act(async () => {
      await result.current(['i1']);
    });
    expect(h.showFlag).toHaveBeenCalledWith(expect.objectContaining({ title: 'ENG-123 reopened' }));
  });

  it('bulk E confirms with a count and one entry that restores every status', async () => {
    h.rows.set('i1', issue('i1', { statusId: 'todo' }));
    h.rows.set('i2', issue('i2', { statusId: 'ip' }));
    const { result } = renderHook(() => useToggleDone(), { wrapper: Wrapper });
    await act(async () => {
      await result.current(['i1', 'i2']);
    });
    expect(h.showFlag).toHaveBeenCalledWith(expect.objectContaining({ title: '2 issues marked Done' }));
    expect(undoDepth()).toBe(1);
    expect(latestUndo()?.label).toBe(m.undo.change.status);
  });
});

describe('archive and trash undo', () => {
  it('archive pushes an entry that unarchives only the issues that were not archived before', async () => {
    h.rows.set('i1', issue('i1'));
    h.rows.set('i2', issue('i2', { archivedAt: '2026-02-01T00:00:00Z' }));
    const { result } = renderHook(() => useArchiveIssues(), { wrapper: Wrapper });
    await act(async () => {
      await result.current(['i1', 'i2']);
    });
    expect(h.run).toHaveBeenCalledWith(ArchiveIssuesDocument, { ids: ['i1', 'i2'], archived: true });
    expect(h.showFlag).toHaveBeenCalledWith(expect.objectContaining({ title: '2 issues archived' }));
    expect(latestUndo()?.label).toBe(m.undo.archive);

    const flag = h.showFlag.mock.calls[0]?.[0] as { action?: { onClick: () => void } };
    await act(async () => {
      flag.action?.onClick();
    });
    await waitFor(() => expect(h.run).toHaveBeenCalledWith(ArchiveIssuesDocument, { ids: ['i1'], archived: false }));
  });

  it('trash pushes an entry that restores the issues from trash', async () => {
    h.rows.set('i1', issue('i1'));
    const { result } = renderHook(() => useTrashIssues(), { wrapper: Wrapper });
    await act(async () => {
      await result.current(['i1']);
    });
    expect(latestUndo()?.label).toBe(m.undo.trash);
    await act(async () => {
      await latestUndo()?.undo();
    });
    expect(h.run).toHaveBeenLastCalledWith(TrashIssuesDocument, { ids: ['i1'], trashed: false });
  });
});

describe('useSetSubscribed', () => {
  it('writes the subscribe flag for the issue through the optimistic mutation', async () => {
    const { result } = renderHook(() => useSetSubscribed(), { wrapper: Wrapper });
    await act(async () => {
      await result.current({ id: 'i1', subscribed: true });
    });
    expect(h.run).toHaveBeenCalledWith(SetIssueSubscribedDocument, { id: 'i1', subscribed: true });
  });

  it('shows the new flag optimistically and rolls back with the generic flag', () => {
    renderHook(() => useSetSubscribed(), { wrapper: Wrapper });
    const contract = h.contracts.get(SetIssueSubscribedDocument) as {
      optimistic: (vars: { id: string; subscribed: boolean }) => unknown;
      rollback: (vars: { id: string; subscribed: boolean }) => string;
    };
    expect(contract.optimistic({ id: 'i1', subscribed: true })).toEqual({
      __typename: 'Mutation',
      setIssueSubscribed: { __typename: 'Issue', id: 'i1', subscribed: true },
    });
    expect(contract.rollback({ id: 'i1', subscribed: true })).toBe(m.flags.rollback.generic);
  });
});
