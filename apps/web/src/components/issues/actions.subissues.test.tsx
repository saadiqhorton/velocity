import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { gql } from '@apollo/client';
import type { InMemoryCache } from '@apollo/client';
import { MockedProvider } from '@apollo/client/testing';
import type { MockedResponse } from '@apollo/client/testing';
import { GraphQLError } from 'graphql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateIssueDocument, StatusFieldsFragmentDoc } from '@/gql/graphql';
import type { StatusFieldsFragment } from '@/gql/graphql';
import { createCache } from '@/lib/apollo';
import { m } from '@/i18n';
import { useCreateIssue } from './actions';

const h = vi.hoisted(() => ({ showFlag: vi.fn<(flag: unknown) => string>(() => 'flag-1') }));

vi.mock('@velocity/ui', async (orig) => ({
  ...(await orig<typeof import('@velocity/ui')>()),
  useFlags: () => ({ showFlag: h.showFlag, dismissFlag: vi.fn() }),
}));

const fx = vi.hoisted(() => {
  const status = { __typename: 'WorkflowStatus', id: 'st-todo', name: 'Todo', category: 'todo', color: 'gray', order: 0, description: null, teamId: 't1' } as unknown as StatusFieldsFragment;
  const team = { id: 't1', key: 'ENG', statuses: [status] };
  return { status, teamsById: new Map([['t1', team]]), viewer: { id: 'me' } };
});

vi.mock('@/app/workspace', () => ({ useWorkspace: () => ({ teamsById: fx.teamsById, teams: [], viewer: fx.viewer }) }));

const PARENT = 'parent-1';
const NEW_ID = '00000000-0000-4000-8000-000000000001';
const TITLE = 'Write the migration notes';

const ParentFields = gql`
  fragment ParentFields on Issue {
    id
    children {
      id
    }
  }
`;

const IdentifierField = gql`
  fragment IdentifierField on Issue {
    identifier
  }
`;

/** The row the server returns: the real identifier replaces the optimistic `ENG-…`. */
function serverRow() {
  return {
    __typename: 'Issue' as const,
    id: NEW_ID,
    identifier: 'ENG-12',
    number: 12,
    title: TITLE,
    priority: 2,
    estimate: null,
    sortOrder: 1,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    completedAt: null,
    archivedAt: null,
    trashedAt: null,
    teamId: 't1',
    statusId: 'st-todo',
    assigneeId: null,
    projectId: null,
    cycleId: null,
    milestoneId: null,
    parentId: PARENT,
    labelIds: [],
    commentCount: 0,
    status: { ...fx.status },
    assignee: null,
    labels: [],
    cycle: null,
    subIssueRollup: { __typename: 'SubIssueRollup' as const, done: 0, total: 0 },
  };
}

function createMock(input: Record<string, unknown>, result: MockedResponse['result'], delay = 40): MockedResponse {
  return { request: { query: CreateIssueDocument, variables: { input: { ...input, id: NEW_ID } } }, result, delay };
}

const SUB_INPUT = { title: TITLE, teamId: 't1', parentId: PARENT };
const TOP_INPUT = { title: TITLE, teamId: 't1' };

/** A cache holding the parent with no sub-issues yet, and the team's default status. */
function seeded(): InMemoryCache {
  const cache = createCache();
  cache.writeFragment({ id: `Issue:${PARENT}`, fragment: ParentFields, data: { __typename: 'Issue', id: PARENT, children: [] } });
  cache.writeFragment({ id: 'WorkflowStatus:st-todo', fragment: StatusFieldsFragmentDoc, data: fx.status });
  return cache;
}

function childIds(cache: InMemoryCache, optimistic: boolean): string[] {
  const parent = cache.readFragment<{ children: { id: string }[] }>({ id: `Issue:${PARENT}`, fragment: ParentFields, optimistic });
  return (parent?.children ?? []).map((c) => c.id);
}

function mountCreate(cache: InMemoryCache, mocks: MockedResponse[]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MockedProvider mocks={mocks} cache={cache}>
      {children}
    </MockedProvider>
  );
  return renderHook(() => useCreateIssue(), { wrapper });
}

beforeEach(() => {
  h.showFlag.mockClear();
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(NEW_ID);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('creating a sub-issue updates the parent list', () => {
  it('lists the new sub-issue under the parent before the server answers, then keeps one entry', async () => {
    const cache = seeded();
    const { result } = mountCreate(cache, [createMock(SUB_INPUT, { data: { __typename: 'Mutation', createIssue: serverRow() } })]);

    let pending!: ReturnType<(typeof result.current)[0]>;
    act(() => {
      pending = result.current[0](SUB_INPUT);
    });
    await waitFor(() => expect(childIds(cache, true)).toEqual([NEW_ID]));
    // The base cache is untouched until the server answers: the entry lives in the optimistic layer.
    expect(childIds(cache, false)).toEqual([]);

    await act(async () => {
      await pending;
    });
    expect(childIds(cache, false)).toEqual([NEW_ID]);
    expect(childIds(cache, true)).toEqual([NEW_ID]);
    expect(cache.readFragment<{ identifier: string }>({ id: `Issue:${NEW_ID}`, fragment: IdentifierField })?.identifier).toBe('ENG-12');
  });

  it('takes the sub-issue back out of the parent when the server rejects the create', async () => {
    const cache = seeded();
    const error = { result: { errors: [new GraphQLError('nope', { extensions: { code: 'VALIDATION' } })] } };
    const { result } = mountCreate(cache, [{ request: { query: CreateIssueDocument, variables: { input: { ...SUB_INPUT, id: NEW_ID } } }, ...error, delay: 40 }]);

    let pending!: ReturnType<(typeof result.current)[0]>;
    act(() => {
      pending = result.current[0](SUB_INPUT);
    });
    await waitFor(() => expect(childIds(cache, true)).toEqual([NEW_ID]));

    let outcome: Awaited<typeof pending> | undefined;
    await act(async () => {
      outcome = await pending;
    });
    expect(outcome?.error).not.toBeNull();
    expect(childIds(cache, true)).toEqual([]);
    expect(childIds(cache, false)).toEqual([]);
    expect(h.showFlag).toHaveBeenCalledWith(expect.objectContaining({ title: m.flags.rollback.create, severity: 'error' }));
  });

  it('leaves every parent alone when the new issue has no parent', async () => {
    const cache = seeded();
    const { result } = mountCreate(cache, [createMock(TOP_INPUT, { data: { __typename: 'Mutation', createIssue: { ...serverRow(), parentId: null } } })]);

    await act(async () => {
      await result.current[0](TOP_INPUT);
    });
    expect(childIds(cache, false)).toEqual([]);
    expect(childIds(cache, true)).toEqual([]);
  });
});
