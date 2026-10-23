import { useCallback } from 'react';
import { useApolloClient, useQuery } from '@apollo/client';
import { Avatar, Icon, PriorityIcon, Skeleton, StatusIcon } from '@velocity/ui';
import { IssueActivityDocument, IssueRowFieldsFragmentDoc } from '@/gql/graphql';
import type { IssueActivityQuery } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import type { WorkspaceData } from '@/app/workspace';
import { formatDateTime, formatRelative } from '@/lib/format';
import { PRIORITY_KEYS } from '@/components/issues/IssueRow';
import { m } from '@/i18n';

type Entry = NonNullable<IssueActivityQuery['issue']>['activity'][number];

export type ActivityEntry = Entry;

/** Who created the issue and when, read from the issue record. */
export interface CreationFact {
  actor: Entry['actor'];
  at: string;
}

/** Stored relation payload: `direction` is `out` from the source row, `in` from the target row. */
interface RelationPayload {
  type?: string;
  direction?: string;
  issueId?: string;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
}

function describeValue(type: string, v: unknown, ws: WorkspaceData): string {
  const s = str(v);
  if (v === null || v === undefined || s === '') return m.common.none;
  switch (type) {
    case 'status':
      return (s && ws.statusesById.get(s)?.name) ?? m.common.unknown;
    case 'assignee':
      return (s && ws.usersById.get(s)?.name) ?? m.common.unknown;
    case 'priority':
      return m.priority[Number(s) as 0 | 1 | 2 | 3 | 4] ?? String(s);
    case 'project':
      return (s && ws.projectsById.get(s)?.name) ?? m.common.unknown;
    case 'labels':
      return Array.isArray(v) ? v.map((id) => ws.labelsById.get(String(id))?.name ?? '?').join(', ') || m.common.none : m.common.none;
    case 'estimate':
      return s ?? m.common.none;
    case 'title':
      return s ? `“${s}”` : m.common.none;
    default:
      return s ?? '';
  }
}

/** Relation phrasing from this issue's side: a blocks or duplicate row reads inverted on the target's side. */
function relationKind(type: string | undefined, direction: string | undefined): string {
  const k = m.activity.relationKinds;
  const inbound = direction === 'in';
  if (type === 'blocks') return inbound ? k.blockedBy : k.blocks;
  if (type === 'duplicate') return inbound ? k.duplicatedBy : k.duplicate;
  return type ?? k.related;
}

/** Identifier of an issue from the Apollo cache. Relations and parents bring it along, so most targets resolve. */
function useIdentifierOf(): (issueId: string) => string | null {
  const { cache } = useApolloClient();
  return useCallback(
    (issueId: string) => {
      // Partial read: a relation target is cached with a few fields only, so the full row is usually incomplete.
      const row = cache.readFragment({
        id: cache.identify({ __typename: 'Issue', id: issueId }),
        fragment: IssueRowFieldsFragmentDoc,
        fragmentName: 'IssueRowFields',
        returnPartialData: true,
      });
      return row?.identifier ?? null;
    },
    [cache],
  );
}

function sentence(e: Entry, ws: WorkspaceData, identifierOf: (issueId: string) => string | null): string {
  const verb = m.activity.verbs[e.type] ?? e.type.replace(/_/g, ' ');
  if (e.type === 'relation_added' || e.type === 'relation_removed') {
    const p = (e.type === 'relation_added' ? e.toValue : e.fromValue) as RelationPayload | null;
    const target = (p?.issueId && identifierOf(p.issueId)) || m.activity.anotherIssue;
    return m.activity.relation(e.type === 'relation_added', relationKind(p?.type, p?.direction), target);
  }
  if (['created', 'description', 'milestone', 'cycle', 'parent', 'archived', 'unarchived', 'trashed', 'restored'].includes(e.type)) return verb;
  if (e.type === 'moved') {
    const to = (e.toValue as { identifier?: string } | null)?.identifier;
    return to ? `${verb} ${to}` : verb;
  }
  return `${verb} ${describeValue(e.type, e.toValue, ws)}`;
}

/** The 16px mark for an event: what changed, not who changed it (the actor is named in the text). */
function EventGlyph({ entry: e, ws }: { entry: Entry; ws: WorkspaceData }) {
  if (e.type === 'status') {
    const s = ws.statusesById.get(str(e.toValue) ?? '');
    if (s) return <StatusIcon category={s.category} color={s.color} label="" />;
  }
  if (e.type === 'priority') return <PriorityIcon priority={PRIORITY_KEYS[Number(str(e.toValue) ?? 4)] ?? 'none'} label="" />;
  if (e.type === 'assignee') {
    const u = ws.usersById.get(str(e.toValue) ?? '');
    return u ? <Avatar name={u.name} src={u.avatarUrl} size={16} /> : <Icon name="user" className="text-fg-subtlest" />;
  }
  if (e.type === 'labels') return <Icon name="label" className="text-fg-subtlest" />;
  if (e.type === 'relation_added' || e.type === 'relation_removed') return <Icon name="relation" className="text-fg-subtlest" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-fg-subtlest" aria-hidden="true" />;
}

/**
 * Adds the issue-created line when the log has none. The server writes one for issues it creates;
 * older rows may not have it, so the creator and creation time from the issue stand in.
 */
export function withCreation(log: readonly Entry[], issueId: string, created: CreationFact | null | undefined): Entry[] {
  if (!created || log.some((e) => e.type === 'created')) return [...log];
  return [
    {
      __typename: 'IssueActivity',
      id: `created:${issueId}`,
      type: 'created',
      actorKind: 'user',
      createdAt: created.at,
      fromValue: null,
      toValue: null,
      actor: created.actor,
    },
    ...log,
  ];
}

/**
 * Types whose sentence states the value after the edit (or only the verb), so the newest row of a burst
 * reads as the final state. Relations, moves and lifecycle events name different things each time: never folded.
 */
const COLLAPSIBLE_TYPES = new Set(['title', 'description', 'status', 'priority', 'assignee', 'project', 'estimate', 'labels', 'milestone', 'cycle', 'parent']);
const BURST_MS = 10 * 60 * 1000;

function isRepeat(older: Entry, newer: Entry): boolean {
  return (
    older.type === newer.type &&
    COLLAPSIBLE_TYPES.has(older.type) &&
    (older.actor?.id ?? older.actorKind) === (newer.actor?.id ?? newer.actorKind) &&
    Date.parse(newer.createdAt) - Date.parse(older.createdAt) <= BURST_MS
  );
}

/**
 * Folds bursts of repeated edits into their newest row. Input is chronological (oldest first); consecutive
 * entries by the same actor, of the same collapsible type, at most 10 minutes apart, collapse to the last one.
 */
export function collapseBursts(entries: readonly Entry[]): Entry[] {
  return entries.filter((e, i) => {
    const next = entries[i + 1];
    return !(next && isRepeat(e, next));
  });
}

/** One history line: what changed, who changed it, when. */
export function ActivityItem({ entry: e }: { entry: Entry }) {
  const ws = useWorkspace();
  const identifierOf = useIdentifierOf();
  const actor = e.actor?.name ?? (e.actorKind === 'github' ? m.activity.actorGithub : e.actorKind === 'import' ? m.activity.actorImport : m.activity.actorSystem);
  return (
    <li className="flex min-h-7 items-center gap-2 px-1 text-base" data-testid="activity-entry">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <EventGlyph entry={e} ws={ws} />
      </span>
      <span className="min-w-0 flex-1 truncate text-fg-subtle">
        <span className="font-medium text-fg">{actor}</span> {sentence(e, ws, identifierOf)}
      </span>
      <time className="shrink-0 text-sm text-fg-subtlest" dateTime={e.createdAt} title={formatDateTime(e.createdAt)}>
        {formatRelative(e.createdAt)}
      </time>
    </li>
  );
}

/** Activity timeline (SPEC §3.5.4): property changes, moves, archive/trash, GitHub events. */
export function ActivityFeed({ issueId, created }: { issueId: string; created?: CreationFact | null }) {
  const { data, loading } = useQuery(IssueActivityDocument, { variables: { id: issueId }, fetchPolicy: 'cache-and-network' });
  // Newest first; the creation line is the oldest, so it lands at the bottom.
  const entries = collapseBursts(withCreation(data?.issue?.activity ?? [], issueId, created)).reverse();
  if (loading && !data) return <Skeleton rows={4} />;
  if (entries.length === 0) return <p className="text-base text-fg-subtlest">{m.issue.noActivity}</p>;
  return (
    <ol className="flex flex-col" data-testid="activity">
      {entries.map((e) => (
        <ActivityItem key={e.id} entry={e} />
      ))}
    </ol>
  );
}
