import { useApolloClient, useQuery } from '@apollo/client';
import type { PopupOption } from '@velocity/ui';
import { TeamCyclesDocument } from '@/gql/graphql';
import type { IssueRowFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { readIssueRow } from '@/lib/issueCache';
import type { CommandPageKey } from '@/keyboard/engine';
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
import { useMoveIssue, useUpdateIssues } from '@/components/issues/actions';
import { applyStatus } from '@/components/overlays/usePickerSpec';
import { m } from '@/i18n';

export interface PageModel {
  placeholder: string;
  /** Stays open after each pick; Enter toggles the option (labels). */
  multiple: boolean;
  options: PopupOption[];
  /** Values already set on every target, shown with a check. */
  selected: string[];
  /** Applies a pick. `wasSelected` tells multi pages whether the pick adds or removes. */
  apply: (value: string, wasSelected: boolean) => void;
}

/** The value every target shares, or undefined when they differ (same rule as the pickers). */
function common<T>(values: T[]): T | undefined {
  return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;
}

function single(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
}

/**
 * Palette rows keep the label, icon and text only. The pickers' digit shortcuts (quick select
 * in the popups) do nothing in the palette, so they are not shown here.
 */
function plain(options: PopupOption[]): PopupOption[] {
  return options.map((o) => ({
    value: o.value,
    label: o.label,
    description: o.description,
    icon: o.icon,
    group: o.group,
    disabled: o.disabled,
    keywords: o.keywords,
  }));
}

/**
 * Options, current values and the apply action for a palette sub-page. Built from the same
 * builders and hooks as the shortcut pickers (PickerHost), so both lists match.
 *
 * Hooks run unconditionally; `key` only chooses which page is returned, so the palette can
 * call this once per render. Returns null while no page is open.
 */
export function usePaletteModel(key: CommandPageKey | null, issueIds: readonly string[]): PageModel | null {
  const ws = useWorkspace();
  const client = useApolloClient();
  const update = useUpdateIssues();
  const move = useMoveIssue();
  const rows = issueIds.map((id) => readIssueRow(client.cache, id)).filter((r): r is IssueRowFieldsFragment => r !== null);
  const first = rows[0];
  const team = first ? ws.teamsById.get(first.teamId) : ws.teams[0];
  const cycles = useQuery(TeamCyclesDocument, {
    variables: { teamId: team?.id ?? '', includeClosed: false, first: 6 },
    skip: key !== 'cycle' || !team?.cycleEnabled,
    fetchPolicy: 'cache-first',
  });
  const ids = [...issueIds];

  switch (key) {
    case null:
      return null;
    case 'status':
      return {
        placeholder: m.palette.pageStatus,
        multiple: false,
        options: plain(team ? statusOptions(team) : []),
        selected: single(common(rows.map((r) => r.statusId))),
        apply: (value) => applyStatus(ws.teamsById, rows, team, value, update),
      };
    case 'priority':
      return {
        placeholder: m.palette.pagePriority,
        multiple: false,
        options: plain(priorityOptions()),
        selected: single(common(rows.map((r) => String(r.priority)))),
        apply: (value) => void update(ids, { priority: Number(value) }),
      };
    case 'assignee':
      return {
        placeholder: m.palette.pageAssignee,
        multiple: false,
        options: plain(assigneeOptions(ws)),
        selected: single(common(rows.map((r) => r.assigneeId ?? NONE))),
        apply: (value) => void update(ids, { assigneeId: value === NONE ? null : value }),
      };
    case 'labels': {
      // Labels present on every target are checked; toggling adds or removes them on all.
      const shared = first?.labelIds.filter((id) => rows.every((r) => r.labelIds.includes(id))) ?? [];
      return {
        placeholder: m.palette.pageLabels,
        multiple: true,
        options: plain(labelOptions(ws)),
        selected: shared,
        apply: (value, wasSelected) => void update(ids, wasSelected ? { removeLabelIds: [value] } : { addLabelIds: [value] }),
      };
    }
    case 'project':
      return {
        placeholder: m.palette.pageProject,
        multiple: false,
        options: plain(projectOptions(ws)),
        selected: single(common(rows.map((r) => r.projectId ?? NONE))),
        apply: (value) => void update(ids, { projectId: value === NONE ? null : value }),
      };
    case 'cycle':
      return {
        placeholder: m.palette.pageCycle,
        multiple: false,
        options: plain(cycleOptions(cycles.data?.cycles ?? [])),
        selected: single(common(rows.map((r) => r.cycleId ?? NONE))),
        apply: (value) => void update(ids, { cycleId: value === NONE ? null : value }),
      };
    case 'estimate':
      return {
        placeholder: m.palette.pageEstimate,
        multiple: false,
        options: plain(estimateOptions(team?.estimateScale)),
        selected: single(common(rows.map((r) => (r.estimate === null ? NONE : String(r.estimate))))),
        apply: (value) => void update(ids, { estimate: value === NONE ? null : Number(value) }),
      };
    case 'team':
      return {
        placeholder: m.palette.pageTeam,
        multiple: false,
        options: plain(teamOptions(ws)),
        selected: single(common(rows.map((r) => r.teamId))),
        apply: (value) => void move(ids, value),
      };
  }
}
