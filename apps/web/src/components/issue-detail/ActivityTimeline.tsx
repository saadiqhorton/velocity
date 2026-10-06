import { useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { Skeleton } from '@velocity/ui';
import { IssueActivityDocument, IssueCommentsDocument } from '@/gql/graphql';
import type { CommentFieldsFragment } from '@/gql/graphql';
import { ActivityItem } from './ActivityFeed';
import type { ActivityEntry } from './ActivityFeed';
import { CommentItem, Composer } from './Comments';
import { m } from '@/i18n';

type Item = { kind: 'comment'; at: string; comment: CommentFieldsFragment } | { kind: 'event'; at: string; entry: ActivityEntry };

/**
 * The issue page's Activity (U1): comments and history in one chronological stream,
 * oldest first so the newest sits right above the comment box.
 */
export function ActivityTimeline({ issueId }: { issueId: string }) {
  const comments = useQuery(IssueCommentsDocument, { variables: { id: issueId }, fetchPolicy: 'cache-and-network' });
  const activity = useQuery(IssueActivityDocument, { variables: { id: issueId }, fetchPolicy: 'cache-and-network' });
  const emoji = comments.data?.reactionEmoji ?? [];

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [
      ...(comments.data?.issue?.comments ?? []).map((c) => ({ kind: 'comment' as const, at: c.createdAt, comment: c })),
      ...(activity.data?.issue?.activity ?? []).map((e) => ({ kind: 'event' as const, at: e.createdAt, entry: e })),
    ];
    return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }, [comments.data, activity.data]);

  const loading = (comments.loading && !comments.data) || (activity.loading && !activity.data);

  return (
    <div className="flex flex-col gap-4" data-testid="activity-timeline">
      {loading ? <Skeleton rows={3} /> : null}
      {!loading && items.length === 0 ? <p className="px-1 text-base text-fg-subtlest">{m.issue.noActivity}</p> : null}
      <ol className="flex flex-col gap-1">
        {items.map((it) =>
          it.kind === 'comment' ? (
            <li key={`c:${it.comment.id}`} className="my-2 rounded-md border border-border bg-surface px-3 py-2.5">
              <CommentItem comment={it.comment} emoji={emoji} />
            </li>
          ) : (
            <ActivityItem key={`e:${it.entry.id}`} entry={it.entry} />
          ),
        )}
      </ol>
      <Composer issueId={issueId} />
    </div>
  );
}
