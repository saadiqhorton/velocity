import { useQuery } from '@apollo/client';
import { Avatar, Icon, Skeleton } from '@velocity/ui';
import { IssueActivityDocument } from '@/gql/graphql';
import type { IssueActivityQuery } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import type { WorkspaceData } from '@/app/workspace';
import { formatDateTime, formatRelative } from '@/lib/format';
import { m } from '@/i18n';

type Entry = NonNullable<IssueActivityQuery['issue']>['activity'][number];

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


function sentence(e: Entry, ws: WorkspaceData): string {
  const verb = m.activity.verbs[e.type] ?? e.type.replace(/_/g, ' ');
  if (['created', 'description', 'milestone', 'cycle', 'parent', 'archived', 'unarchived', 'trashed', 'restored'].includes(e.type)) return verb;
  if (e.type === 'moved') {
    const to = (e.toValue as { identifier?: string } | null)?.identifier;
    return to ? `${verb} ${to}` : verb;
  }
  return `${verb} ${describeValue(e.type, e.toValue, ws)}`;
}

/** Activity timeline (SPEC §3.5.4): property changes, moves, archive/trash, GitHub events. */
export function ActivityFeed({ issueId }: { issueId: string }) {
  const ws = useWorkspace();
  const { data, loading } = useQuery(IssueActivityDocument, { variables: { id: issueId }, fetchPolicy: 'cache-and-network' });
  const entries = [...(data?.issue?.activity ?? [])].reverse();
  if (loading && !data) return <Skeleton rows={4} />;
  if (entries.length === 0) return <p className="text-base text-fg-subtlest">{m.issue.noActivity}</p>;
  return (
    <ol className="flex flex-col" data-testid="activity">
      {entries.map((e) => {
        const actor = e.actor?.name ?? (e.actorKind === 'github' ? m.activity.actorGithub : e.actorKind === 'import' ? m.activity.actorImport : m.activity.actorSystem);
        return (
          <li key={e.id} className="flex min-h-8 items-start gap-2 py-1 text-base">
            <span className="mt-0.5 flex w-5 justify-center">
              {e.actor ? <Avatar name={e.actor.name} src={e.actor.avatarUrl} size={20} /> : <Icon name={e.actorKind === 'github' ? 'github' : 'refresh'} className="text-fg-subtlest" />}
            </span>
            <span className="min-w-0 flex-1 text-fg-subtle">
              <span className="font-medium text-fg">{actor}</span> {sentence(e, ws)}
            </span>
            <time className="shrink-0 text-sm text-fg-subtlest" dateTime={e.createdAt} title={formatDateTime(e.createdAt)}>
              {formatRelative(e.createdAt)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
