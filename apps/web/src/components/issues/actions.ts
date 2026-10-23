import { useCallback } from 'react';
import { useApolloClient } from '@apollo/client';
import type { ApolloCache, Reference } from '@apollo/client';
import { useFlags } from '@velocity/ui';
import {
  ArchiveIssuesDocument,
  BulkUpdateIssuesDocument,
  CreateIssueDocument,
  DuplicateIssueDocument,
  MoveIssueDocument,
  SetIssueSubscribedDocument,
  ToggleIssueDoneDocument,
  TrashIssuesDocument,
  UpdateIssueDocument,
} from '@/gql/graphql';
import type { CreateIssueInput, IssueRowFieldsFragment, UpdateIssueInput } from '@/gql/graphql';
import { asArray, useOptimisticMutation } from '@/lib/mutation';
import { optimisticIssues, patchIssueRow, readIssueRow, readStatus, toggleDoneStatus } from '@/lib/issueCache';
import { forgetUndo, pushUndo, useRunUndo } from '@/lib/undo';
import type { UndoEntry } from '@/lib/undo';
import { useWorkspace } from '@/app/workspace';
import { useSelection } from '@/stores/selection';
import { m } from '@/i18n';

function idLabel(cache: ApolloCache<unknown>, id: string): string {
  return readIssueRow(cache, id)?.identifier ?? id;
}

/** Fields an update can be reverted on: each is read from the cached row and written back by the optimistic patch. */
type Revertible = 'title' | 'priority' | 'estimate' | 'statusId' | 'assigneeId' | 'projectId' | 'milestoneId' | 'parentId' | 'cycleId' | 'labelIds';

/** Input key to the row field it writes. Any other key (descriptionMd, ...) cannot be reverted from the cache. */
const REVERTIBLE: Partial<Record<keyof UpdateIssueInput, Revertible>> = {
  title: 'title',
  priority: 'priority',
  estimate: 'estimate',
  statusId: 'statusId',
  assigneeId: 'assigneeId',
  projectId: 'projectId',
  milestoneId: 'milestoneId',
  parentId: 'parentId',
  cycleId: 'cycleId',
  labelIds: 'labelIds',
  addLabelIds: 'labelIds',
  removeLabelIds: 'labelIds',
};

const CHANGE_KEY: Record<Revertible, keyof typeof m.undo.change> = {
  title: 'title',
  priority: 'priority',
  estimate: 'estimate',
  statusId: 'status',
  assigneeId: 'assignee',
  projectId: 'project',
  milestoneId: 'milestone',
  parentId: 'parent',
  cycleId: 'cycle',
  labelIds: 'labels',
};

/** The reversible fields an update touches, or null when it touches one the cache cannot restore. */
function revertibleFields(input: UpdateIssueInput): Revertible[] | null {
  const fields = new Set<Revertible>();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const field = REVERTIBLE[key as keyof UpdateIssueInput];
    if (!field) return null;
    fields.add(field);
  }
  return fields.size > 0 ? [...fields] : null;
}

/** "status change" for one field, "issue changes" for several. Resolved at call time so the locale applies. */
function changeLabel(fields: readonly Revertible[]): string {
  const only = fields[0];
  return fields.length === 1 && only ? m.undo.change[CHANGE_KEY[only]] : m.undo.change.many;
}

interface RevertGroup {
  ids: string[];
  input: UpdateIssueInput;
}

/**
 * The inverse of a change, per issue: each issue's previous values for the touched fields. Issues
 * with the same previous values share one mutation. Null when a row is not cached, because its
 * previous values are unknown.
 */
function revertGroups(cache: ApolloCache<unknown>, ids: readonly string[], fields: readonly Revertible[]): RevertGroup[] | null {
  const groups = new Map<string, RevertGroup>();
  for (const id of ids) {
    const row = readIssueRow(cache, id);
    if (!row) return null;
    const input = Object.fromEntries(fields.map((f): [Revertible, unknown] => [f, row[f]])) as UpdateIssueInput;
    const key = JSON.stringify(input);
    const group = groups.get(key) ?? { ids: [], input };
    group.ids.push(id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

type ApplyUpdate = (ids: readonly string[], input: UpdateIssueInput) => Promise<boolean>;

/**
 * Undo entry that writes each group's previous values back through the same optimistic update. The restored
 * issues are listed first, so one that a refresh had dropped from the loaded list shows at once.
 */
function revertEntry(label: string, cache: ApolloCache<unknown>, groups: readonly RevertGroup[], apply: ApplyUpdate): UndoEntry {
  return {
    label,
    undo: () => {
      for (const g of groups) relistRestored(cache, g.ids, g.input);
      return Promise.all(groups.map((g) => apply(g.ids, g.input))).then((oks) => oks.every(Boolean));
    },
  };
}

/** Push the entry for a change that is being applied; drop it again if the server rejects the change. */
function track(entry: UndoEntry | null, applied: Promise<boolean>): Promise<boolean> {
  if (entry) pushUndo(entry);
  return applied.then((ok) => {
    if (!ok && entry) forgetUndo(entry);
    return ok;
  });
}

/** Flag Undo action for an entry, or none when the change could not be recorded. */
function undoAction(entry: UndoEntry | null, runUndo: (entry: UndoEntry) => void) {
  return entry ? { label: m.common.undo, onClick: () => runUndo(entry) } : undefined;
}

/** The optimistic issue update without undo or feedback. Resolves true when the server accepted it. */
function useApplyUpdate(): ApplyUpdate {
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
      if (ids.length === 0) return Promise.resolve(true);
      if (ids.length === 1) return single({ id: ids[0] as string, input }).then((res) => res.error === null);
      return bulk({ ids: [...ids], input }).then((res) => res.error === null);
    },
    [single, bulk],
  );
}

/** Flag title for a done toggle: "ENG-1 marked Done" or "ENG-1 reopened" for one issue, a count for several. */
function toggleTitle(cache: ApolloCache<unknown>, ids: readonly string[], reopen: boolean): string {
  const [only] = ids;
  if (ids.length === 1 && only) {
    const id = idLabel(cache, only);
    return reopen ? m.issue.reopened(id) : m.issue.markedDone(id);
  }
  return reopen ? m.issue.bulkReopened(ids.length) : m.issue.bulkMarkedDone(ids.length);
}

/** Flag title for a bulk edit: "3 issues moved to In Progress" for a status, "3 issues updated" otherwise. */
function bulkChangeTitle(cache: ApolloCache<unknown>, n: number, input: UpdateIssueInput): string {
  const status = input.statusId ? readStatus(cache, input.statusId) : null;
  return status ? m.issue.bulkMoved(n, status.name) : m.issue.bulkUpdated(n);
}

/**
 * Update one or many issues (bulk when more than one). Optimistic, with rollback flags. Every
 * change can be undone (Ctrl+Z); a bulk change also confirms with an Undo flag.
 */
export function useUpdateIssues() {
  const client = useApolloClient();
  const apply = useApplyUpdate();
  const { showFlag } = useFlags();
  const runUndo = useRunUndo();
  return useCallback(
    (ids: readonly string[], input: UpdateIssueInput) => {
      if (ids.length === 0) return Promise.resolve();
      const fields = revertibleFields(input);
      const groups = fields ? revertGroups(client.cache, ids, fields) : null;
      const entry = fields && groups ? revertEntry(changeLabel(fields), client.cache, groups, apply) : null;
      return track(entry, apply(ids, input)).then((ok) => {
        if (!ok || ids.length < 2) return;
        showFlag({ title: bulkChangeTitle(client.cache, ids.length, input), severity: 'success', action: undoAction(entry, runUndo) });
      });
    },
    [apply, client, showFlag, runUndo],
  );
}

export function useToggleDone() {
  const { teamsById } = useWorkspace();
  const client = useApolloClient();
  const apply = useApplyUpdate();
  const { showFlag } = useFlags();
  const runUndo = useRunUndo();
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
      if (ids.length === 0) return Promise.resolve();
      const rows = ids.map((id) => readIssueRow(client.cache, id)).filter((r): r is IssueRowFieldsFragment => r !== null);
      // Mark all done, or reopen all if every one is done.
      const reopen = rows.length > 0 && rows.every((r) => r.status.category === 'done');
      const groups = revertGroups(client.cache, ids, ['statusId']);
      const entry = groups ? revertEntry(m.undo.change.status, client.cache, groups, apply) : null;
      const title = toggleTitle(client.cache, ids, reopen);
      let written: Promise<boolean>;
      if (ids.length === 1) {
        written = toggle({ id: ids[0] as string }).then((res) => res.error === null);
      } else {
        const byTeam = new Map<string, string[]>();
        for (const r of rows) byTeam.set(r.teamId, [...(byTeam.get(r.teamId) ?? []), r.id]);
        written = Promise.all(
          [...byTeam].map(([teamId, teamIds]) => {
            const team = teamsById.get(teamId);
            const first = rows.find((r) => r.teamId === teamId);
            const target = team && first ? toggleDoneStatus(team.statuses, reopen ? first.status : { ...first.status, category: 'todo' }) : null;
            return target ? apply(teamIds, { statusId: target.id }) : Promise.resolve(true);
          }),
        ).then((oks) => oks.every(Boolean));
      }
      return track(entry, written).then((ok) => {
        if (ok) showFlag({ title, severity: 'success', action: undoAction(entry, runUndo) });
      });
    },
    [toggle, client, teamsById, apply, showFlag, runUndo],
  );
}

export function useArchiveIssues() {
  const { showFlag } = useFlags();
  const client = useApolloClient();
  const clear = useSelection((s) => s.clear);
  const runUndo = useRunUndo();
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
      const list = [...ids];
      // Undo restores only the issues that were not archived before: archiving an archived one changes nothing.
      const restore = list.filter((id) => !readIssueRow(client.cache, id)?.archivedAt);
      const entry: UndoEntry | null =
        restore.length > 0
          ? {
              label: m.undo.archive,
              undo: () => {
                relistRestored(client.cache, restore);
                return archive({ ids: restore, archived: false }).then((res) => res.error === null);
              },
            }
          : null;
      const ok = await track(entry, archive({ ids: list, archived: true }).then((res) => res.error === null));
      if (ok) showFlag({ title: m.issue.archivedFlag(list.length), severity: 'success', action: undoAction(entry, runUndo) });
    },
    [archive, client, clear, showFlag, runUndo],
  );
}

export function useTrashIssues() {
  const { showFlag } = useFlags();
  const client = useApolloClient();
  const clear = useSelection((s) => s.clear);
  const runUndo = useRunUndo();
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
      const list = [...ids];
      // Undo restores only the issues that were not in trash before.
      const restore = list.filter((id) => !readIssueRow(client.cache, id)?.trashedAt);
      const entry: UndoEntry | null =
        restore.length > 0
          ? {
              label: m.undo.trash,
              undo: () => {
                relistRestored(client.cache, restore);
                return trash({ ids: restore, trashed: false }).then((res) => res.error === null);
              },
            }
          : null;
      const ok = await track(entry, trash({ ids: list, trashed: true }).then((res) => res.error === null));
      if (ok) showFlag({ title: m.issue.deleted(list.length), severity: 'success', action: undoAction(entry, runUndo) });
    },
    [trash, client, clear, showFlag, runUndo],
  );
}

/**
 * Whether a cached `issues(...)` list plausibly contains a new issue: same team (or no team
 * scope) and no project/cycle/milestone/parent/filter constraint the client cannot evaluate.
 */
export function listAccepts(storeFieldName: string, issue: Pick<IssueRowFieldsFragment, 'teamId' | 'projectId' | 'cycleId' | 'milestoneId' | 'parentId'>): boolean {
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
  const match = (key: 'teamId' | 'projectId' | 'cycleId' | 'milestoneId' | 'parentId') => args[key] === null || args[key] === undefined || args[key] === issue[key];
  return match('teamId') && match('projectId') && match('cycleId') && match('milestoneId') && match('parentId');
}

/**
 * Prepends an issue into every cached `issues(...)` list that accepts it, unless the list holds it already. The
 * server refresh positions it. A refresh can drop a row that moved out of the loaded window, so undo lists it again.
 */
function listIssue(cache: ApolloCache<unknown>, issue: IssueRowFieldsFragment): void {
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
}

/**
 * Lists the issues an undo restores, as they will read once `input` is written back, before the server answers.
 * Issues that are not cached are skipped: the server result lists them.
 */
function relistRestored(cache: ApolloCache<unknown>, ids: readonly string[], input: UpdateIssueInput = {}): void {
  for (const id of ids) {
    const row = readIssueRow(cache, id);
    if (row) listIssue(cache, patchIssueRow(cache, row, input));
  }
}

/** Default status for new issues: first backlog status, else first todo (SPEC §3.5). */
export function defaultStatusFor(team: { statuses: readonly { id: string; category: string; order: number }[] }): string | null {
  const sorted = [...team.statuses].sort((a, b) => a.order - b.order);
  return (sorted.find((s) => s.category === 'backlog') ?? sorted.find((s) => s.category === 'todo') ?? sorted[0])?.id ?? null;
}

/**
 * Lists a new sub-issue under its parent's `children` (the sub-issue list on the issue page), so
 * the quick-add shows it before the server answers. Runs again on the server result; the
 * reference check keeps the parent to one entry.
 */
function listAsSubIssue(cache: ApolloCache<unknown>, parentId: string, issue: IssueRowFieldsFragment): void {
  cache.modify({
    id: cache.identify({ __typename: 'Issue' as const, id: parentId }),
    fields: {
      children(value, { toReference }) {
        const existing = value as Reference[];
        const ref = toReference(issue);
        if (!ref || existing.some((n) => n.__ref === ref.__ref)) return existing;
        return [...existing, ref];
      },
    },
  });
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
    update: (cache, result, vars) => {
      const issue = result.data?.createIssue;
      if (!issue) return;
      listIssue(cache, issue);
      if (vars.input.parentId) listAsSubIssue(cache, vars.input.parentId, issue);
    },
    // The parent's sub-issue rollup (done/total) is not patched optimistically; the parent detail refetches for it.
    refetchQueries: ['IssueGroupCounts', 'SidebarCounts', 'IssueDetail'],
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

/** Subscribe or unsubscribe to an issue's activity. Shared by the page toggle, the panel bell and the ⋯ menu. */
export function useSetSubscribed() {
  const [set] = useOptimisticMutation(SetIssueSubscribedDocument, {
    optimistic: (vars) => ({ __typename: 'Mutation' as const, setIssueSubscribed: { __typename: 'Issue' as const, id: vars.id, subscribed: vars.subscribed } }),
    rollback: () => m.flags.rollback.generic,
  });
  return set;
}
