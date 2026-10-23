import { useCallback } from 'react';
import { ReorderIssueDocument } from '@/gql/graphql';
import type { IssueRowFieldsFragment } from '@/gql/graphql';
import { dropPlan, slotNeighbours } from '@/lib/grouping';
import type { GroupBy } from '@/lib/grouping';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';
import { useUpdateIssues } from './actions';

export interface DropTarget {
  /** Group the drop landed in. */
  key: string | null;
  /** Ids of the target group in display order (the dragged issues may be among them). */
  members: readonly string[];
  /** The row or card the drop landed on, when it did. */
  slot?: { id: string; below: boolean };
}

/**
 * Drop handling shared by the list and the board: the group field moves first (one optimistic
 * field update), then a single issue is placed in its slot under manual ordering. `reorder` is
 * the same optimistic mutation the keyboard path (⌥↑/↓) uses.
 */
export function useIssueDrop(issues: readonly IssueRowFieldsFragment[], grouping: GroupBy, manual: boolean) {
  const update = useUpdateIssues();
  const [reorder] = useOptimisticMutation(ReorderIssueDocument, {
    optimistic: (vars) => {
      const before = issues.find((i) => i.id === vars.beforeId);
      const after = issues.find((i) => i.id === vars.afterId);
      const sortOrder =
        before && after ? (before.sortOrder + after.sortOrder) / 2 : before ? before.sortOrder + 1 : after ? after.sortOrder - 1 : 1000;
      return { __typename: 'Mutation' as const, reorderIssue: { __typename: 'Issue' as const, id: vars.id, sortOrder } };
    },
    rollback: () => m.flags.rollback.reorder,
    pulse: (vars) => [vars.id],
  });

  const drop = useCallback(
    (ids: readonly string[], target: DropTarget) => {
      const inTarget = new Set(target.members);
      const moving = ids.filter((id) => !inTarget.has(id));
      // Dropping a card onto itself is not a slot.
      const slot = target.slot && !ids.includes(target.slot.id) ? target.slot : undefined;
      const plan = dropPlan({ grouping, manual, targetKey: target.key, moving: moving.length, count: ids.length, onSlot: slot !== undefined });
      if (plan.patch) void update(moving, plan.patch);
      const id = ids[0];
      if (!plan.reorder || !id || !slot) return;
      const neighbours = slotNeighbours(target.members.filter((x) => x !== id), slot.id, slot.below);
      if (neighbours) void reorder({ id, ...neighbours });
    },
    [grouping, manual, update, reorder],
  );

  return { drop, reorder };
}
