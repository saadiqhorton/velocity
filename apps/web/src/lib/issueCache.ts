/**
 * Optimistic builders for issue mutations (SPEC §5.4): read the current normalized
 * entity, apply the patch, and resolve references (status, assignee, labels, cycle)
 * from entities already in the cache.
 */
import type { ApolloCache } from '@apollo/client';
import {
  IssueRowFieldsFragmentDoc,
  LabelFieldsFragmentDoc,
  StatusFieldsFragmentDoc,
  UserFieldsFragmentDoc,
  CycleFieldsFragmentDoc,
} from '@/gql/graphql';
import type { IssueRowFieldsFragment, StatusFieldsFragment, UpdateIssueInput } from '@/gql/graphql';

type Cache = ApolloCache<unknown>;

export function readIssueRow(cache: Cache, id: string): IssueRowFieldsFragment | null {
  return cache.readFragment({
    id: cache.identify({ __typename: 'Issue' as const, id }),
    fragment: IssueRowFieldsFragmentDoc,
    fragmentName: 'IssueRowFields',
  });
}

export function readStatus(cache: Cache, id: string): StatusFieldsFragment | null {
  return cache.readFragment({ id: cache.identify({ __typename: 'WorkflowStatus' as const, id }), fragment: StatusFieldsFragmentDoc });
}

function readUserLite(cache: Cache, id: string): IssueRowFieldsFragment['assignee'] {
  const u = cache.readFragment({ id: cache.identify({ __typename: 'User' as const, id }), fragment: UserFieldsFragmentDoc });
  return u ? { __typename: 'User' as const, id: u.id, name: u.name, avatarUrl: u.avatarUrl } : null;
}

function readLabelLite(cache: Cache, id: string): IssueRowFieldsFragment['labels'][number] | null {
  const l = cache.readFragment({ id: cache.identify({ __typename: 'Label' as const, id }), fragment: LabelFieldsFragmentDoc });
  return l ? { __typename: 'Label' as const, id: l.id, name: l.name, color: l.color } : null;
}

function readCycleLite(cache: Cache, id: string): IssueRowFieldsFragment['cycle'] {
  const c = cache.readFragment({ id: cache.identify({ __typename: 'Cycle' as const, id }), fragment: CycleFieldsFragmentDoc });
  return c ? { __typename: 'Cycle' as const, id: c.id, number: c.number, name: c.name, startsAt: c.startsAt } : null;
}

const has = <K extends keyof UpdateIssueInput>(input: UpdateIssueInput, key: K): boolean =>
  Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;

/** Apply an UpdateIssueInput to a cached issue row. Returns null if the issue is not cached. */
export function patchIssueRow(cache: Cache, current: IssueRowFieldsFragment, input: UpdateIssueInput, now = new Date()): IssueRowFieldsFragment {
  const next: IssueRowFieldsFragment = { ...current, updatedAt: now.toISOString() };
  if (has(input, 'title') && input.title) next.title = input.title;
  if (has(input, 'priority') && input.priority !== null) next.priority = input.priority as number;
  if (has(input, 'estimate')) next.estimate = input.estimate ?? null;
  if (has(input, 'statusId') && input.statusId) {
    const status = readStatus(cache, input.statusId);
    if (status) {
      next.statusId = status.id;
      next.status = status;
      const done = status.category === 'done';
      next.completedAt = done ? (current.completedAt ?? now.toISOString()) : null;
    }
  }
  if (has(input, 'assigneeId')) {
    next.assigneeId = input.assigneeId ?? null;
    next.assignee = input.assigneeId ? readUserLite(cache, input.assigneeId) : null;
  }
  if (has(input, 'projectId')) next.projectId = input.projectId ?? null;
  if (has(input, 'milestoneId')) next.milestoneId = input.milestoneId ?? null;
  if (has(input, 'parentId')) next.parentId = input.parentId ?? null;
  if (has(input, 'cycleId')) {
    next.cycleId = input.cycleId ?? null;
    next.cycle = input.cycleId ? readCycleLite(cache, input.cycleId) : null;
  }
  let labelIds = [...current.labelIds];
  if (has(input, 'labelIds')) labelIds = [...(input.labelIds ?? [])];
  if (input.addLabelIds?.length) for (const id of input.addLabelIds) if (!labelIds.includes(id)) labelIds.push(id);
  if (input.removeLabelIds?.length) labelIds = labelIds.filter((id) => !input.removeLabelIds?.includes(id));
  if (labelIds.join() !== current.labelIds.join()) {
    next.labelIds = labelIds;
    next.labels = labelIds.flatMap((id) => {
      const l = readLabelLite(cache, id) ?? current.labels.find((x) => x.id === id) ?? null;
      return l ? [l] : [];
    });
  }
  return next;
}

export function optimisticIssues(cache: Cache, ids: readonly string[], input: UpdateIssueInput): IssueRowFieldsFragment[] {
  return ids.flatMap((id) => {
    const cur = readIssueRow(cache, id);
    return cur ? [patchIssueRow(cache, cur, input)] : [];
  });
}

/** The status to use for "mark done" toggles: first `done` status of the team, or back to the first started/unstarted status. */
export function toggleDoneStatus(statuses: readonly StatusFieldsFragment[], current: StatusFieldsFragment): StatusFieldsFragment | null {
  const sorted = [...statuses].sort((a, b) => a.order - b.order);
  if (current.category === 'done') {
    return sorted.find((s) => s.category === 'todo') ?? sorted.find((s) => s.category === 'backlog') ?? null;
  }
  return sorted.find((s) => s.category === 'done') ?? null;
}
