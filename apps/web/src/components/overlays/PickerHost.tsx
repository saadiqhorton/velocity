import { useEffect, useState } from 'react';
import { useApolloClient, useQuery } from '@apollo/client';
import { PopupSelect } from '@velocity/ui';
import type { PopupOption } from '@velocity/ui';
import { TeamCyclesDocument } from '@/gql/graphql';
import type { IssueRowFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { readIssueRow } from '@/lib/issueCache';
import { useUi } from '@/stores/ui';
import type { PickerRequest } from '@/stores/ui';
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
import { RelationDialog } from './RelationDialog';
import { m } from '@/i18n';

function common<T>(values: T[]): T | undefined {
  return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;
}

function ActivePicker({ req }: { req: PickerRequest }) {
  const ws = useWorkspace();
  const client = useApolloClient();
  const close = useUi((s) => s.closePicker);
  const update = useUpdateIssues();
  const move = useMoveIssue();
  const rows = req.issueIds.map((id) => readIssueRow(client.cache, id)).filter((r): r is IssueRowFieldsFragment => r !== null);
  const first = rows[0];
  const team = first ? ws.teamsById.get(first.teamId) : ws.teams[0];
  const cyclesQ = useQuery(TeamCyclesDocument, {
    variables: { teamId: team?.id ?? '', includeClosed: false, first: 6 },
    skip: req.kind !== 'cycle' || !team?.cycleEnabled,
    fetchPolicy: 'cache-first',
  });
  const ids = req.issueIds;
  const onOpenChange = (open: boolean) => {
    if (!open) close();
  };

  let label: string;
  let options: PopupOption[];
  let value: string | string[] | null;
  let multiple = false;
  let commit: (v: string | string[]) => void;

  switch (req.kind) {
    case 'status': {
      label = m.issue.status;
      options = team ? statusOptions(team) : [];
      value = common(rows.map((r) => r.statusId)) ?? null;
      commit = (v) => {
        const chosen = team?.statuses.find((s) => s.id === v);
        if (!chosen) return;
        // Bulk across teams: apply the status with the same name (or category) in each team.
        const byTeam = new Map<string, string[]>();
        for (const r of rows) byTeam.set(r.teamId, [...(byTeam.get(r.teamId) ?? []), r.id]);
        for (const [teamId, teamIds] of byTeam) {
          const t = ws.teamsById.get(teamId);
          const match =
            teamId === team?.id
              ? chosen
              : (t?.statuses.find((s) => s.name.toLowerCase() === chosen.name.toLowerCase()) ?? t?.statuses.find((s) => s.category === chosen.category));
          if (match) void update(teamIds, { statusId: match.id });
        }
      };
      break;
    }
    case 'priority':
      label = m.issue.priority;
      options = priorityOptions();
      value = common(rows.map((r) => String(r.priority))) ?? null;
      commit = (v) => void update(ids, { priority: Number(v) });
      break;
    case 'assignee':
      label = m.issue.assignee;
      options = assigneeOptions(ws);
      value = common(rows.map((r) => r.assigneeId ?? NONE)) ?? null;
      commit = (v) => void update(ids, { assigneeId: v === NONE ? null : (v as string) });
      break;
    case 'labels': {
      label = m.issue.labels;
      options = labelOptions(ws);
      multiple = true;
      // Labels present on every target are checked; toggling adds/removes for all.
      const shared = rows.length ? rows[0]!.labelIds.filter((id) => rows.every((r) => r.labelIds.includes(id))) : [];
      value = shared;
      commit = (v) => {
        const next = v as string[];
        const added = next.filter((id) => !shared.includes(id));
        const removed = shared.filter((id) => !next.includes(id));
        if (added.length || removed.length) void update(ids, { addLabelIds: added, removeLabelIds: removed });
      };
      break;
    }
    case 'project':
      label = m.issue.project;
      options = projectOptions(ws);
      value = common(rows.map((r) => r.projectId ?? NONE)) ?? null;
      commit = (v) => void update(ids, { projectId: v === NONE ? null : (v as string) });
      break;
    case 'cycle':
      label = m.issue.cycle;
      options = cycleOptions(cyclesQ.data?.cycles ?? []);
      value = common(rows.map((r) => r.cycleId ?? NONE)) ?? null;
      commit = (v) => void update(ids, { cycleId: v === NONE ? null : (v as string) });
      break;
    case 'estimate':
      label = m.issue.estimate;
      options = estimateOptions(team?.estimateScale);
      value = common(rows.map((r) => (r.estimate === null ? NONE : String(r.estimate)))) ?? null;
      commit = (v) => void update(ids, { estimate: v === NONE ? null : Number(v) });
      break;
    case 'team':
      label = m.issue.moveToTeam;
      options = teamOptions(ws);
      value = common(rows.map((r) => r.teamId)) ?? null;
      commit = (v) => void move(ids, v as string);
      break;
    default:
      return null;
  }

  const key = `${req.kind}-${ids.join(',')}`;
  if (multiple) {
    return (
      <PopupSelect
        key={key}
        label={label}
        options={options}
        anchorEl={req.anchor}
        open
        onOpenChange={onOpenChange}
        multiple
        value={(value as string[] | null) ?? []}
        onChange={(v: string[]) => commit(v)}
      />
    );
  }
  return (
    <PopupSelect
      key={key}
      label={label}
      options={options}
      anchorEl={req.anchor}
      open
      onOpenChange={onOpenChange}
      value={value as string | null}
      onChange={(v: string) => commit(v)}
    />
  );
}

/** Returns focus to where it was when the popup opened (SPEC §4.12 focus rules). */
function FocusReturn() {
  const [previous] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (previous && document.contains(previous) && (!active || active === document.body)) previous.focus({ preventScroll: true });
      });
    },
    [previous],
  );
  return null;
}

/** Shortcut popups (S, A, L, P, M…) anchored to the focused row (SPEC §4.12). */
export function PickerHost() {
  const req = useUi((s) => s.picker);
  const close = useUi((s) => s.closePicker);
  if (!req) return null;
  return (
    <>
      <FocusReturn />
      {req.kind === 'relation' ? <RelationDialog issueId={req.issueIds[0] ?? ''} onClose={close} /> : <ActivePicker req={req} />}
    </>
  );
}
