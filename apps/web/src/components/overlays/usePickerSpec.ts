import { useApolloClient, useQuery } from '@apollo/client';
import type { PopupOption } from '@velocity/ui';
import { TeamCyclesDocument } from '@/gql/graphql';
import type { IssueRowFieldsFragment, TeamFieldsFragment, UpdateIssueInput } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { readIssueRow } from '@/lib/issueCache';
import { useMoveIssue, useUpdateIssues } from '@/components/issues/actions';
import {
  NONE,
  assigneeOptions,
  cycleOptions,
  estimateOptions,
  labelOptions,
  priorityOptions,
  projectOptions,
  statusOptions,
  teamOptions,
} from '@/components/issues/pickers';
import type { PickerKind } from '@/stores/ui';
import { m } from '@/i18n';

/** What a property picker offers and how a choice applies. Shared by the popups and the menu's submenus. */
export type PickerSpec =
  | { label: string; options: PopupOption[]; multiple: false; value: string | null; commit: (value: string) => void }
  | { label: string; options: PopupOption[]; multiple: true; value: string[]; commit: (values: string[]) => void };

function common<T>(values: T[]): T | undefined {
  return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;
}

/** Labels present on every row: the checked set of the labels picker. */
function sharedLabels(rows: readonly IssueRowFieldsFragment[]): string[] {
  return (rows[0]?.labelIds ?? []).filter((id) => rows.every((r) => r.labelIds.includes(id)));
}

/**
 * Applies a status to the target rows. In the team the status was picked from it is used as is; in
 * other teams the status with the same name, else the same category. Shared by the S popup, the
 * ⋯ menu's Status submenu and the command palette's status page.
 */
export function applyStatus(
  teamsById: ReadonlyMap<string, TeamFieldsFragment>,
  rows: readonly IssueRowFieldsFragment[],
  team: TeamFieldsFragment | undefined,
  statusId: string,
  update: (ids: readonly string[], input: UpdateIssueInput) => Promise<void>,
): void {
  const chosen = team?.statuses.find((s) => s.id === statusId);
  if (!chosen) return;
  const byTeam = new Map<string, string[]>();
  for (const r of rows) byTeam.set(r.teamId, [...(byTeam.get(r.teamId) ?? []), r.id]);
  for (const [teamId, teamIds] of byTeam) {
    const t = teamsById.get(teamId);
    const match =
      teamId === team?.id
        ? chosen
        : (t?.statuses.find((s) => s.name.toLowerCase() === chosen.name.toLowerCase()) ?? t?.statuses.find((s) => s.category === chosen.category));
    if (match) void update(teamIds, { statusId: match.id });
  }
}

/**
 * Options and commit for one property over `issueIds`, for the S/A/L/P/M popups and the context
 * menu's submenus. Null for kinds with their own dialog (relation) or no list (milestone).
 */
export function usePickerSpec(kind: PickerKind, issueIds: readonly string[]): PickerSpec | null {
  const ws = useWorkspace();
  const client = useApolloClient();
  const update = useUpdateIssues();
  const move = useMoveIssue();
  const ids = [...issueIds];
  // Read again at commit time: labels toggle one at a time, and each toggle changes what is shared.
  const rowsNow = () => ids.map((id) => readIssueRow(client.cache, id)).filter((r): r is IssueRowFieldsFragment => r !== null);
  const rows = rowsNow();
  const first = rows[0];
  const team = first ? ws.teamsById.get(first.teamId) : ws.teams[0];
  const cyclesQ = useQuery(TeamCyclesDocument, {
    variables: { teamId: team?.id ?? '', includeClosed: false, first: 6 },
    skip: kind !== 'cycle' || !team?.cycleEnabled,
    fetchPolicy: 'cache-first',
  });

  switch (kind) {
    case 'status':
      return {
        label: m.issue.status,
        options: team ? statusOptions(team) : [],
        multiple: false,
        value: common(rows.map((r) => r.statusId)) ?? null,
        commit: (v) => applyStatus(ws.teamsById, rows, team, v, update),
      };
    case 'priority':
      return {
        label: m.issue.priority,
        options: priorityOptions(),
        multiple: false,
        value: common(rows.map((r) => String(r.priority))) ?? null,
        commit: (v) => void update(ids, { priority: Number(v) }),
      };
    case 'assignee':
      return {
        label: m.issue.assignee,
        options: assigneeOptions(ws),
        multiple: false,
        value: common(rows.map((r) => r.assigneeId ?? NONE)) ?? null,
        commit: (v) => void update(ids, { assigneeId: v === NONE ? null : v }),
      };
    case 'labels':
      return {
        label: m.issue.labels,
        options: labelOptions(ws),
        multiple: true,
        value: sharedLabels(rows),
        commit: (next) => {
          const shared = sharedLabels(rowsNow());
          const added = next.filter((id) => !shared.includes(id));
          const removed = shared.filter((id) => !next.includes(id));
          if (added.length || removed.length) void update(ids, { addLabelIds: added, removeLabelIds: removed });
        },
      };
    case 'project':
      return {
        label: m.issue.project,
        options: projectOptions(ws),
        multiple: false,
        value: common(rows.map((r) => r.projectId ?? NONE)) ?? null,
        commit: (v) => void update(ids, { projectId: v === NONE ? null : v }),
      };
    case 'cycle':
      return {
        label: m.issue.cycle,
        options: cycleOptions(cyclesQ.data?.cycles ?? []),
        multiple: false,
        value: common(rows.map((r) => r.cycleId ?? NONE)) ?? null,
        commit: (v) => void update(ids, { cycleId: v === NONE ? null : v }),
      };
    case 'estimate':
      return {
        label: m.issue.estimate,
        options: estimateOptions(team?.estimateScale),
        multiple: false,
        value: common(rows.map((r) => (r.estimate === null ? NONE : String(r.estimate)))) ?? null,
        commit: (v) => void update(ids, { estimate: v === NONE ? null : Number(v) }),
      };
    case 'team':
      return {
        label: m.issue.moveToTeam,
        options: teamOptions(ws),
        multiple: false,
        value: common(rows.map((r) => r.teamId)) ?? null,
        commit: (v) => void move(ids, v),
      };
    default:
      return null;
  }
}
