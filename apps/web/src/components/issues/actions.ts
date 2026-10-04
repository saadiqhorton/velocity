import { useCallback } from 'react';
import { useApolloClient } from '@apollo/client';
import type { Reference } from '@apollo/client';
import { useFlags } from '@velocity/ui';
import {
  ArchiveIssuesDocument,
  BulkUpdateIssuesDocument,
  CreateIssueDocument,
  DuplicateIssueDocument,
  MoveIssueDocument,
  ToggleIssueDoneDocument,
  TrashIssuesDocument,
  UpdateIssueDocument,
} from '@/gql/graphql';
import type { CreateIssueInput, IssueRowFieldsFragment, UpdateIssueInput } from '@/gql/graphql';
import { asArray, useOptimisticMutation } from '@/lib/mutation';
import { optimisticIssues, patchIssueRow, readIssueRow, readStatus, toggleDoneStatus } from '@/lib/issueCache';
import { useWorkspace } from '@/app/workspace';
import { useSelection } from '@/stores/selection';
import { m } from '@/i18n';

function idLabel(cache: ReturnType<typeof useApolloClient>['cache'], id: string): string {
  return readIssueRow(cache, id)?.identifier ?? id;
}

/** Update one or many issues (bulk when more than one). Optimistic, with rollback flags. */
export function useUpdateIssues() {
  const client = useApolloClient();
  const [single] = useOptimisticMutation(UpdateIssueDocument, {
    optimistic: (vars, cache) => {
      const cur = readIssueRow(cache, vars.id);
      if (!cur) throw new Error('not cached');
      return { __typename: 'Mutation' as const, updateIssue: patchIssueRow(cache, cur, vars.input) };
    },
    rollback: (vars) => m.flags.rollback.update(idLabel(client.cache, vars.id)),
    pulse: (vars) => [vars.id],
  });
  const [bulk] = useOptimisticMutation(BulkUpdateIssuesDocument, {
    optimistic: (vars, cache) => ({ __typename: 'Mutation' as const, bulkUpdateIssues: optimisticIssues(cache, asArray(vars.ids), vars.input) }),
    rollback: (vars) => m.flags.rollback.bulk(asArray(vars.ids).length),
    pulse: (vars) => asArray(vars.ids),
  });
  return useCallback(
    (ids: readonly string[], input: UpdateIssueInput) => {
      if (ids.length === 0) return Promise.resolve();
      if (ids.length === 1) return single({ id: ids[0] as string, input }).then(() => undefined);
      return bulk({ ids: [...ids], input }).then(() => undefined);
    },
    [single, bulk],
  );
}

export function useToggleDone() {
  const { teamsById } = useWorkspace();
  const update = useUpdateIssues();
  const client = useApolloClient();
  const [toggle] = useOptimisticMutation(ToggleIssueDoneDocument, {
    optimistic: (vars, cache) => {
      const cur = readIssueRow(cache, vars.id);
      if (!cur) throw new Error('not cached');
      const team = teamsById.get(cur.teamId);
      const target = team ? toggleDoneStatus(team.statuses, cur.status) : null;
      return { __typename: 'Mutation' as const, toggleIssueDone: target ? patchIssueRow(cache, cur, { statusId: target.id }) : cur };
    },
    rollback: (vars) => m.flags.rollback.update(idLabel(client.cache, vars.id)),
    pulse: (vars) => [vars.id],
  });
  return useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 1) return toggle({ id: ids[0] as string }).then(() => undefined);
      // Bulk: mark all done (or reopen all if every one is done).
      const rows = ids.map((id) => readIssueRow(client.cache, id)).filter((r): r is IssueRowFieldsFragment => r !== null);
      const allDone = rows.every((r) => r.status.category === 'done');
      const byTeam = new Map<string, string[]>();
      for (const r of rows) byTeam.set(r.teamId, [...(byTeam.get(r.teamId) ?? []), r.id]);
      return Promise.all(
        [...byTeam].map(([teamId, teamIds]) => {
          const team = teamsById.get(teamId);
          const first = rows.find((r) => r.teamId === teamId);
          const target = team && first ? toggleDoneStatus(team.statuses, allDone ? first.status : { ...first.status, category: 'todo' }) : null;
          return target ? update(teamIds, { statusId: target.id }) : Promise.resolve();
        }),
      ).then(() => undefined);
    },
    [toggle, client, teamsById, update],
  );
}

export function useArchiveIssues() {
  const { showFlag } = useFlags();
  const clear = useSelection((s) => s.clear);
  const [archive] = useOptimisticMutation(ArchiveIssuesDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      archiveIssues: asArray(vars.ids).map((id) => ({ __typename: 'Issue' as const, id, archivedAt: vars.archived ? new Date().toISOString() : null })),
    }),
    rollback: () => m.flags.rollback.archive,
  });
  return useCallback(
    async (ids: readonly string[]) => {
      clear();
      const res = await archive({ ids: [...ids], archived: true });
      if (res.data) {
        showFlag({
          title: m.issue.archivedFlag(ids.length),
          severity: 'success',
          action: { label: m.common.undo, onClick: () => void archive({ ids: [...ids], archived: false }) },
        });
      }
    },
    [archive, clear, showFlag],
  );
}

export function useTrashIssues() {
  const { showFlag } = useFlags();
  const clear = useSelection((s) => s.clear);
  const [trash] = useOptimisticMutation(TrashIssuesDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      trashIssues: asArray(vars.ids).map((id) => ({ __typename: 'Issue' as const, id, trashedAt: vars.trashed ? new Date().toISOString() : null })),
    }),
    rollback: () => m.flags.rollback.delete,
  });
  return useCallback(
    async (ids: readonly string[]) => {
      clear();
      const res = await trash({ ids: [...ids], trashed: true });
      if (res.data) {
        showFlag({
          title: m.issue.deleted(ids.length),
          severity: 'success',
          action: { label: m.common.undo, onClick: () => void trash({ ids: [...ids], trashed: false }) },
        });
      }
    },
    [trash, clear, showFlag],
  );
}

/**
 * Whether a cached `issues(...)` list plausibly contains a new issue: same team (or no team
 * scope) and no project/cycle/parent/filter constraint the client cannot evaluate.
 */
export function listAccepts(storeFieldName: string, issue: Pick<IssueRowFieldsFragment, 'teamId' | 'projectId' | 'cycleId' | 'parentId'>): boolean {
  const brace = storeFieldName.indexOf('{');
  if (brace === -1) return false;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(storeFieldName.slice(brace)) as Record<string, unknown>;
  } catch {
    return false;
  }
  if (args.filter || args.subscribed || args.onlyTrashed) return false;
  if (args.teamKey) return false;
  const match = (key: 'teamId' | 'projectId' | 'cycleId' | 'parentId') => args[key] === null || args[key] === undefined || args[key] === issue[key];
  return match('teamId') && match('projectId') && match('cycleId') && match('parentId');
}

/** Default status for new issues: first backlog status, else first todo (SPEC §3.5). */
export function defaultStatusFor(team: { statuses: readonly { id: string; category: string; order: number }[] }): string | null {
  const sorted = [...team.statuses].sort((a, b) => a.order - b.order);
  return (sorted.find((s) => s.category === 'backlog') ?? sorted.find((s) => s.category === 'todo') ?? sorted[0])?.id ?? null;
}

/** Optimistic create with a client-minted UUID (SPEC §5.4). */
export function useCreateIssue() {
  const { teamsById, viewer } = useWorkspace();
  const [create, state] = useOptimisticMutation(CreateIssueDocument, {
    optimistic: (vars, cache) => {
      const input = vars.input;
      const team = input.teamId ? teamsById.get(input.teamId) : undefined;
      const statusId = input.statusId ?? (team ? defaultStatusFor(team) : null);
      const status = statusId ? readStatus(cache, statusId) : null;
      if (!team || !status || !input.id) throw new Error('cannot predict');
      const now = new Date().toISOString();
      const base: IssueRowFieldsFragment = {
        __typename: 'Issue' as const,
        id: input.id,
        identifier: `${team.key}-…`,
        number: 0,
        title: input.title,
        priority: input.priority ?? 2,
        estimate: input.estimate ?? null,
        sortOrder: input.sortOrder ?? -Date.now(),
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        archivedAt: null,
        trashedAt: null,
        teamId: team.id,
        statusId: status.id,
        assigneeId: null,
        projectId: null,
        cycleId: null,
        milestoneId: null,
        parentId: input.parentId ?? null,
        labelIds: [],
        commentCount: 0,
        status,
        assignee: null,
        labels: [],
        cycle: null,
        subIssueRollup: { __typename: 'SubIssueRollup' as const, done: 0, total: 0 },
      };
      const row = patchIssueRow(cache, base, {
        assigneeId: input.assigneeId ?? null,
        projectId: input.projectId ?? null,
        cycleId: input.cycleId ?? null,
        milestoneId: input.milestoneId ?? null,
        labelIds: input.labelIds ?? [],
      });
      void viewer;
      return { __typename: 'Mutation' as const, createIssue: row };
    },
    rollback: () => m.flags.rollback.create,
    pulse: (vars) => (vars.input.id ? [vars.input.id] : []),
    update: (cache, result) => {
      const issue = result.data?.createIssue;
      if (!issue) return;
      // Prepend into every cached list of the same team; the server refresh positions it.
      cache.modify({
        fields: {
          issues(value, { storeFieldName, toReference }) {
            const existing = value as { nodes: Reference[] } | undefined;
            if (!existing || !listAccepts(storeFieldName, issue)) return value;
            const ref = toReference(issue);
            if (!ref || existing.nodes.some((n) => n.__ref === ref.__ref)) return value;
            return { ...existing, nodes: [ref, ...existing.nodes] };
          },
        },
      });
    },
    refetchQueries: ['IssueGroupCounts', 'SidebarCounts'],
  });
  const run = useCallback(
    (input: Omit<CreateIssueInput, 'id'>) => create({ input: { ...input, id: crypto.randomUUID() } }),
    [create],
  );
  return [run, state] as const;
}

export function useMoveIssue() {
  const client = useApolloClient();
  const { teamsById } = useWorkspace();
  const [move] = useOptimisticMutation(MoveIssueDocument, {
    optimistic: (vars, cache) => {
      const cur = readIssueRow(cache, vars.id);
      const team = teamsById.get(vars.teamId);
      const statusId = vars.statusId ?? (team ? defaultStatusFor(team) : null);
      const status = statusId ? readStatus(cache, statusId) : null;
      if (!cur || !team || !status) throw new Error('cannot predict');
      return {
        __typename: 'Mutation' as const,
        moveIssue: { ...cur, teamId: team.id, identifier: `${team.key}-…`, statusId: status.id, status, cycleId: null, cycle: null },
      };
    },
    rollback: () => m.flags.rollback.move,
    refetchQueries: ['IssueList', 'IssueGroupCounts'],
  });
  return useCallback(
    (ids: readonly string[], teamId: string) =>
      Promise.all(ids.map((id) => (readIssueRow(client.cache, id)?.teamId === teamId ? null : move({ id, teamId })))).then(() => undefined),
    [move, client],
  );
}

export function useDuplicateIssue() {
  const [dup] = useOptimisticMutation(DuplicateIssueDocument, {
    optimistic: { serverConfirmed: 'The copy gets a new number from the team counter; shown once the server returns it.' },
    rollback: () => m.flags.rollback.generic,
    refetchQueries: ['IssueList', 'IssueGroupCounts'],
  });
  return dup;
}
