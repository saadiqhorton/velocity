import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { gql } from '@apollo/client';
import type { InMemoryCache } from '@apollo/client';
import { MockedProvider } from '@apollo/client/testing';
import type { MockedResponse } from '@apollo/client/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveIssuesDocument, IssueRowFieldsFragmentDoc, StatusFieldsFragmentDoc, UpdateIssueDocument } from '@/gql/graphql';
import type { StatusFieldsFragment } from '@/gql/graphql';
import { createCache } from '@/lib/apollo';
import { latestUndo, resetUndo } from '@/lib/undo';
import { useArchiveIssues, useUpdateIssues } from './actions';

const h = vi.hoisted(() => ({ showFlag: vi.fn<(flag: unknown) => string>(() => 'flag-1') }));

vi.mock('@velocity/ui', async (orig) => ({
  ...(await orig<typeof import('@velocity/ui')>()),
  useFlags: () => ({ showFlag: h.showFlag, dismissFlag: vi.fn() }),
}));

vi.mock('@/app/workspace', () => ({ useWorkspace: () => ({ teamsById: new Map(), teams: [], viewer: { id: 'me' } }) }));

const TODO = { __typename: 'WorkflowStatus', id: 'st-todo', name: 'Todo', category: 'todo', color: 'gray', order: 1, description: null, teamId: 't1' } as unknown as StatusFieldsFragment;
const IN_PROGRESS = { ...TODO, id: 'st-ip', name: 'In Progress', category: 'in_progress', order: 2 } as unknown as StatusFieldsFragment;

/** One issue's row as the server returns it (every IssueRowFields field). */
function issueRow(statusId: string, archivedAt: string | null = null) {
  return {
    __typename: 'Issue' as const,
    id: 'i1',
    identifier: 'ENG-1',
    number: 1,
    title: 'Issue',
    priority: 2,
    estimate: null,
    sortOrder: 1,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    completedAt: null,
    archivedAt,
    trashedAt: null,
    teamId: 't1',
    statusId,
    assigneeId: null,
    projectId: null,
    cycleId: null,
    milestoneId: null,
    parentId: null,
    labelIds: [],
    commentCount: 0,
    status: statusId === TODO.id ? TODO : IN_PROGRESS,
    assignee: null,
    labels: [],
    cycle: null,
    subIssueRollup: { __typename: 'SubIssueRollup' as const, done: 0, total: 0 },
  };
}

const LIST = gql`
  query SeedList($teamId: ID) {
    issues(teamId: $teamId) {
      nodes {
        id
      }
    }
  }
`;

/** A cache with issue i1 in Todo and a team list that holds only `other`: a refresh dropped i1 from the loaded window. */
function seeded(): InMemoryCache {
  const cache = createCache();
  cache.writeFragment({ id: `WorkflowStatus:${TODO.id}`, fragment: StatusFieldsFragmentDoc, data: TODO });
  cache.writeFragment({ id: `WorkflowStatus:${IN_PROGRESS.id}`, fragment: StatusFieldsFragmentDoc, data: IN_PROGRESS });
  cache.writeFragment({ id: 'Issue:i1', fragment: IssueRowFieldsFragmentDoc, fragmentName: 'IssueRowFields', data: issueRow(TODO.id) });
  cache.writeQuery({
    query: LIST,
    variables: { teamId: 't1' },
    data: { issues: { __typename: 'IssueConnection', nodes: [{ __typename: 'Issue', id: 'other' }] } },
  });
  return cache;
}

function statusOf(cache: InMemoryCache, optimistic: boolean): string | undefined {
  return cache.readFragment<{ status: { name: string } }>({ id: 'Issue:i1', fragment: IssueRowFieldsFragmentDoc, fragmentName: 'IssueRowFields', optimistic })?.status.name;
}

function listedIds(cache: InMemoryCache, optimistic: boolean): string[] {
  const root = cache.extract(optimistic).ROOT_QUERY ?? {};
  const key = Object.keys(root).find((k) => k.startsWith('issues:'));
  const conn = key ? (root[key] as { nodes: { __ref: string }[] }) : undefined;
  return (conn?.nodes ?? []).map((n) => n.__ref.slice('Issue:'.length));
}

function mount(cache: InMemoryCache, mocks: MockedResponse[]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MockedProvider mocks={mocks} cache={cache}>
      {children}
    </MockedProvider>
  );
  return renderHook(() => ({ update: useUpdateIssues(), archive: useArchiveIssues() }), { wrapper });
}

const FORWARD: MockedResponse = {
  request: { query: UpdateIssueDocument, variables: { id: 'i1', input: { statusId: IN_PROGRESS.id } } },
  result: { data: { __typename: 'Mutation', updateIssue: issueRow(IN_PROGRESS.id) } },
  delay: 10,
};

/** The undo is slow on purpose: every assertion below runs while the server has not answered. */
const UNDO: MockedResponse = {
  request: { query: UpdateIssueDocument, variables: { id: 'i1', input: { statusId: TODO.id } } },
  result: { data: { __typename: 'Mutation', updateIssue: issueRow(TODO.id) } },
  delay: 200,
};

function latestEntry() {
  const entry = latestUndo();
  if (!entry) throw new Error('no undo entry was pushed');
  return entry;
}

beforeEach(() => {
  resetUndo();
  h.showFlag.mockClear();
});

describe('undo of a status change is optimistic', () => {
  it('the previous status is in the optimistic layer while the server has not answered', async () => {
    const cache = seeded();
    const { result } = mount(cache, [FORWARD, UNDO]);
    await act(async () => {
      await result.current.update(['i1'], { statusId: IN_PROGRESS.id });
    });
    expect(statusOf(cache, false)).toBe('In Progress');

    let settled = false;
    act(() => {
      void latestEntry()
        .undo()
        .then(() => {
          settled = true;
        });
    });
    await waitFor(() => expect(statusOf(cache, true)).toBe('Todo'));
    expect(settled).toBe(false);
    expect(statusOf(cache, false)).toBe('In Progress');
    await waitFor(() => expect(statusOf(cache, false)).toBe('Todo'));
  });

  it('lists the issue again at once when a refresh had dropped it from the loaded list', async () => {
    const cache = seeded();
    const { result } = mount(cache, [FORWARD, UNDO]);
    await act(async () => {
      await result.current.update(['i1'], { statusId: IN_PROGRESS.id });
    });
    expect(listedIds(cache, true)).toEqual(['other']);

    let pending!: Promise<void>;
    act(() => {
      pending = latestEntry().undo().then(() => undefined);
    });
    // Synchronous with the Ctrl+Z: the row is back in the list before the server answers.
    expect(listedIds(cache, true)).toEqual(['i1', 'other']);
    expect(statusOf(cache, true)).toBe('Todo');

    await act(async () => {
      await pending;
    });
    expect(listedIds(cache, false)).toEqual(['i1', 'other']);
  });

  it('an archive undo lists the issue again before the server answers', async () => {
    const cache = seeded();
    const ARCHIVE: MockedResponse = {
      request: { query: ArchiveIssuesDocument, variables: { ids: ['i1'], archived: true } },
      result: { data: { __typename: 'Mutation', archiveIssues: [{ __typename: 'Issue', id: 'i1', archivedAt: '2026-10-15T00:00:00Z' }] } },
      delay: 10,
    };
    const UNARCHIVE: MockedResponse = {
      request: { query: ArchiveIssuesDocument, variables: { ids: ['i1'], archived: false } },
      result: { data: { __typename: 'Mutation', archiveIssues: [{ __typename: 'Issue', id: 'i1', archivedAt: null }] } },
      delay: 200,
    };
    const { result } = mount(cache, [ARCHIVE, UNARCHIVE]);
    await act(async () => {
      await result.current.archive(['i1']);
    });
    expect(listedIds(cache, true)).toEqual(['other']);

    let pending!: Promise<void>;
    act(() => {
      pending = latestEntry().undo().then(() => undefined);
    });
    expect(listedIds(cache, true)).toEqual(['i1', 'other']);

    await act(async () => {
      await pending;
    });
  });
});
