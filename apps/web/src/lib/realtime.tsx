import { useEffect } from 'react';
import { useApolloClient } from '@apollo/client';
import type { ApolloClient, ObservableQuery } from '@apollo/client';
import { NotificationCreatedDocument, WorkspaceEventsDocument } from '@/gql/graphql';
import { runInBackground } from './errors';

/** Queries that depend on issue data. Workspace-level topics refresh every active query. */
const ISSUE_SCOPED = new Set([
  'IssueList',
  'IssueGroupCounts',
  'IssueDetail',
  'IssueComments',
  'IssueActivity',
  'Notifications',
  'SidebarCounts',
  'Projects',
  'ProjectDetail',
  'TeamCycles',
  'CycleDetail',
  'Insights',
  'CyclesClosingSoon',
  'Bootstrap',
]);

const ISSUE_TOPIC = /^(issue|comment|relation|github)\./;

export const PAGE_SIZE = 100;
const MAX_REFRESH = 1000;

/** Refetch an issue list with as many rows as are loaded, so refreshes never truncate the scroll. */
export function refreshIssueList(oq: ObservableQuery<unknown, Record<string, unknown>>) {
  const data = oq.getCurrentResult().data as { issues?: { nodes: unknown[] } } | undefined;
  const loaded = data?.issues?.nodes.length ?? 0;
  const first = Math.min(MAX_REFRESH, Math.max(PAGE_SIZE, loaded));
  return oq.refetch({ ...oq.variables, first, after: null });
}

export function refetchForTopics(client: ApolloClient<unknown>, topics: ReadonlySet<string>) {
  const issueOnly = [...topics].every((t) => ISSUE_TOPIC.test(t));
  return client.refetchQueries({
    include: 'active',
    onQueryUpdated(oq) {
      const name = oq.queryName ?? '';
      if (issueOnly && !ISSUE_SCOPED.has(name)) return false;
      if (name === 'IssueList') return refreshIssueList(oq as ObservableQuery<unknown, Record<string, unknown>>);
      return oq.refetch();
    },
  });
}

/**
 * Realtime (SPEC §5.5): the `workspaceEvents` invalidation stream triggers a debounced
 * refetch of what is on screen. Entity updates merge into the normalized cache.
 */
export function Realtime() {
  const client = useApolloClient();
  useEffect(() => {
    let topics = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstAt = 0;
    const flush = () => {
      timer = null;
      firstAt = 0;
      const t = topics;
      topics = new Set();
      runInBackground(refetchForTopics(client, t));
    };
    const schedule = () => {
      const now = Date.now();
      if (!firstAt) firstAt = now;
      if (timer) clearTimeout(timer);
      // Trailing 300ms debounce, capped at 1.5s so a mutation storm still refreshes.
      timer = setTimeout(flush, now - firstAt > 1500 ? 0 : 300);
    };
    const events = client.subscribe({ query: WorkspaceEventsDocument }).subscribe({
      next: ({ data }) => {
        if (!data) return;
        topics.add(data.workspaceEvents.topic);
        schedule();
      },
      error: () => undefined,
    });
    const notifications = client.subscribe({ query: NotificationCreatedDocument }).subscribe({
      next: () => {
        runInBackground(client.refetchQueries({ include: ['SidebarCounts', 'Notifications'] }));
      },
      error: () => undefined,
    });
    return () => {
      events.unsubscribe();
      notifications.unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [client]);
  return null;
}
