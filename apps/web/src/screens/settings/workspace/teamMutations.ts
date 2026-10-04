import { UpdateTeamDocument } from '@/gql/graphql';
import type { TeamFieldsFragment, UpdateTeamInput } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import type { MutationContract } from '@/lib/mutation';
import type { UpdateTeamMutation, UpdateTeamMutationVariables } from '@/gql/graphql';

/** Apply an UpdateTeam input onto a cached team (optimistic result). */
export function applyTeamPatch(team: TeamFieldsFragment, input: UpdateTeamInput): TeamFieldsFragment {
  return {
    ...team,
    name: input.name ?? team.name,
    key: input.key ?? team.key,
    color: input.color ?? team.color,
    icon: input.icon !== undefined ? input.icon : team.icon,
    description: input.description !== undefined ? input.description : team.description,
    cycleEnabled: input.cycleEnabled ?? team.cycleEnabled,
    cycleLengthWeeks: input.cycleLengthWeeks ?? team.cycleLengthWeeks,
    cycleStartDay: input.cycleStartDay ?? team.cycleStartDay,
    cycleTimezone: input.cycleTimezone ?? team.cycleTimezone,
    carryOver: input.carryOver ?? team.carryOver,
    estimateScale: input.estimateScale ?? team.estimateScale,
  };
}

export function useUpdateTeam(team: TeamFieldsFragment, rollback: string, extra?: Pick<MutationContract<UpdateTeamMutation, UpdateTeamMutationVariables>, 'silent' | 'refetchQueries'>) {
  return useOptimisticMutation(UpdateTeamDocument, {
    optimistic: (vars) => ({ __typename: 'Mutation' as const, updateTeam: applyTeamPatch(team, vars.input) }),
    rollback: () => rollback,
    ...extra,
  });
}
