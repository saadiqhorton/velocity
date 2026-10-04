import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@apollo/client';
import type { ApolloCache, Reference } from '@apollo/client';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { Avatar, Button, EmptyState, Icon, IconButton, InlineMessage, Skeleton, StatusIcon, useFlags } from '@velocity/ui';
import {
  DeleteNotificationsDocument,
  MarkAllNotificationsReadDocument,
  MarkNotificationsReadDocument,
  NotificationsDocument,
} from '@/gql/graphql';
import type { NotificationPreset, NotificationsQuery } from '@/gql/graphql';
import { ViewHeader } from '@/components/shell/ViewHeader';
import { PresetTabs } from '@/components/common/PresetTabs';
import { useCommands } from '@/keyboard/react';
import { asArray, useOptimisticMutation } from '@/lib/mutation';
import { useOpenIssue, usePanelIssueId } from '@/lib/navigation';
import { describeError } from '@/lib/errors';
import { dayLabel, formatDateTime, formatRelative } from '@/lib/format';
import { m } from '@/i18n';

type Notification = NotificationsQuery['notifications'][number];
type Preset = 'all' | 'unread' | 'assigned' | 'subscribed';
const PRESETS: Preset[] = ['all', 'unread', 'assigned', 'subscribed'];
const PRESET_ENUM: Record<Preset, NotificationPreset> = { all: 'all', unread: 'unread', assigned: 'assigned', subscribed: 'subscribed' };

interface Section {
  key: string;
  label: string;
  items: Notification[];
}

/** Unread first (one group), then read notifications grouped by day (SPEC §4.11.10). */
export function groupNotifications(items: readonly Notification[]): Section[] {
  const byTime = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sections: Section[] = [];
  const unread = byTime.filter((n) => !n.readAt);
  if (unread.length) sections.push({ key: 'unread', label: m.inbox.unreadGroup, items: unread });
  const days = new Map<string, Section>();
  for (const n of byTime) {
    if (!n.readAt) continue;
    const d = new Date(n.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let s = days.get(key);
    if (!s) {
      s = { key, label: dayLabel(n.createdAt), items: [] };
      days.set(key, s);
      sections.push(s);
    }
    s.items.push(n);
  }
  return sections;
}

function actorName(n: Notification): string {
  return n.actor?.name ?? '';
}

function summaryOf(n: Notification): string {
  const fn = m.inbox.type[n.type];
  return fn(actorName(n));
}

function TypeIcon({ n }: { n: Notification }) {
  const cls = 'shrink-0 text-fg-subtle';
  switch (n.type) {
    case 'status_changed':
      return n.issue ? <StatusIcon category={n.issue.status.category} color={n.issue.status.color} label="" /> : <Icon name="refresh" className={cls} />;
    case 'comment':
      return <Icon name="comment" className={cls} />;
    case 'mentioned':
      return <Icon name="user" className={cls} />;
    case 'assigned':
      return <Icon name="my-issues" className={cls} />;
    case 'priority_changed':
      return <Icon name="arrow-up" className={cls} />;
    case 'relation_added':
      return <Icon name="relation" className={cls} />;
    default:
      return <Icon name="github" className={cls} />;
  }
}

function InboxSkeleton() {
  return (
    <div role="status" aria-label={m.common.loading} className="flex flex-col">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-3 px-5">
          <Skeleton width={8} height={8} />
          <Skeleton width={16} height={16} />
          <Skeleton width={20} height={20} />
          <Skeleton width={56} height={12} />
          <Skeleton width={`${28 + ((i * 29) % 36)}%`} height={12} />
        </div>
      ))}
    </div>
  );
}

function rowKey(id: string): string {
  return `[data-notification-row="${CSS.escape(id)}"]`;
}

/** Inbox: unread-first, day-grouped notification feed with keyboard triage (SPEC §4.11.10). */
export function Inbox() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('preset');
  const preset: Preset = PRESETS.includes(raw as Preset) ? (raw as Preset) : 'all';
  const { showFlag } = useFlags();
  const openIssue = useOpenIssue();
  const panelIssueId = usePanelIssueId();
  const listRef = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const pendingFocus = useRef(false);
  const deltaRef = useRef(0);

  const { data, loading, error, refetch } = useQuery(NotificationsDocument, {
    variables: { preset: PRESET_ENUM[preset], first: 200 },
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: false,
  });

  const items = useMemo(() => {
    const all = data?.notifications ?? [];
    return preset === 'unread' ? all.filter((n) => !n.readAt) : all;
  }, [data, preset]);
  const sections = useMemo(() => groupNotifications(items), [items]);
  const order = useMemo(() => sections.flatMap((s) => s.items.map((n) => n.id)), [sections]);
  const unreadCount = data?.unreadNotificationCount ?? 0;

  const [markRead] = useOptimisticMutation(MarkNotificationsReadDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      markNotificationsRead: asArray(vars.ids).map((id) => ({ __typename: 'Notification' as const, id, readAt: vars.read ? new Date().toISOString() : null })),
    }),
    rollback: () => m.flags.rollback.notification,
    update: (cache) => {
      adjustUnread(cache, deltaRef.current);
    },
    refetchQueries: ['SidebarCounts'],
  });

  const [markAll] = useOptimisticMutation(MarkAllNotificationsReadDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, markAllNotificationsRead: unreadCount }),
    rollback: () => m.flags.rollback.notification,
    update: (cache) => {
      for (const n of data?.notifications ?? []) {
        if (!n.readAt) cache.modify({ id: cache.identify({ __typename: 'Notification', id: n.id }), fields: { readAt: () => new Date().toISOString() } });
      }
      cache.modify({ fields: { unreadNotificationCount: () => 0 } });
    },
    refetchQueries: ['SidebarCounts', 'Notifications'],
  });

  const [remove] = useOptimisticMutation(DeleteNotificationsDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, deleteNotifications: true }),
    rollback: () => m.flags.rollback.notification,
    update: (cache, _res, vars) => {
      const refs = new Set(asArray(vars.ids).map((id) => cache.identify({ __typename: 'Notification', id })));
      cache.modify({
        fields: {
          notifications(current: Reference | readonly Reference[] = []) {
            const list = Array.isArray(current) ? (current as readonly Reference[]) : [];
            return list.filter((r) => !refs.has(r.__ref));
          },
        },
      });
      adjustUnread(cache, deltaRef.current);
    },
    refetchQueries: ['SidebarCounts'],
  });

  const byId = useMemo(() => new Map(items.map((n) => [n.id, n])), [items]);
  const setRead = useCallback(
    (id: string, read: boolean) => {
      const n = byId.get(id);
      if (!n) return;
      if (Boolean(n.readAt) === read) return;
      deltaRef.current = read ? -1 : 1;
      void markRead({ ids: [id], read });
    },
    [byId, markRead],
  );

  const focusRow = useCallback((id: string | null) => {
    setFocusedId(id);
    pendingFocus.current = true;
  }, []);

  useEffect(() => {
    if (!pendingFocus.current || !focusedId) return;
    pendingFocus.current = false;
    const el = listRef.current?.querySelector<HTMLElement>(rowKey(focusedId));
    el?.focus({ preventScroll: false });
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedId, order]);

  // Keep a valid roving target as the list changes.
  const tabStopId = focusedId && order.includes(focusedId) ? focusedId : (order[0] ?? null);

  const open = useCallback(
    (n: Notification) => {
      setFocusedId(n.id);
      if (!n.readAt) setRead(n.id, true);
      if (n.issue) openIssue(n.issue.id, { identifier: n.issue.identifier });
    },
    [openIssue, setRead],
  );

  const move = (delta: 1 | -1) => {
    if (order.length === 0) return;
    const cur = tabStopId ? order.indexOf(tabStopId) : -1;
    const nextIdx = focused() ? Math.max(0, Math.min(order.length - 1, cur + delta)) : delta === 1 ? 0 : order.length - 1;
    const next = order[nextIdx];
    if (!next) return;
    focusRow(next);
    const n = byId.get(next);
    // With the panel open, J/K walks the panel along (Linear parity).
    if (panelIssueId && n?.issue && n.issue.id !== panelIssueId) openIssue(n.issue.id, { identifier: n.issue.identifier });
  };

  const focusedRow = (): HTMLElement | null => {
    const a = document.activeElement;
    return a instanceof HTMLElement && listRef.current?.contains(a) ? a.closest<HTMLElement>('[data-notification-row]') : null;
  };
  const focused = () => focusedRow() !== null;
  const listActive = () => {
    const a = document.activeElement;
    if (!a || a === document.body || a.id === 'main-content') return true;
    return Boolean(listRef.current?.contains(a));
  };
  const focusedNotification = (): Notification | null => {
    const id = focusedRow()?.getAttribute('data-notification-row');
    return id ? (byId.get(id) ?? null) : null;
  };

  const deleteOne = (n: Notification) => {
    const idx = order.indexOf(n.id);
    const nextId = order[idx + 1] ?? order[idx - 1] ?? null;
    deltaRef.current = n.readAt ? 0 : -1;
    void remove({ ids: [n.id] });
    focusRow(nextId);
  };

  useCommands(() => [
    { id: 'inbox.down', title: m.cmd.moveDown, group: 'list', keys: ['j', 'arrowdown'], scope: 'list', repeat: true, palette: false, when: listActive, run: () => move(1) },
    { id: 'inbox.up', title: m.cmd.moveUp, group: 'list', keys: ['k', 'arrowup'], scope: 'list', repeat: true, palette: false, when: listActive, run: () => move(-1) },
    {
      id: 'inbox.open',
      title: m.cmd.openIssue,
      group: 'list',
      keys: ['enter'],
      scope: 'list',
      palette: false,
      when: () => focusedNotification() !== null,
      run: () => {
        const n = focusedNotification();
        if (n) open(n);
      },
    },
    {
      id: 'inbox.toggleRead',
      title: m.inbox.markRead,
      group: 'list',
      keys: ['e'],
      scope: 'list',
      when: () => focusedNotification() !== null,
      run: () => {
        const n = focusedNotification();
        if (!n) return;
        setRead(n.id, !n.readAt);
        // In the Unread preset the row leaves the list: move on to the next one.
        if (preset === 'unread' && !n.readAt) focusRow(order[order.indexOf(n.id) + 1] ?? order[order.indexOf(n.id) - 1] ?? null);
      },
    },
    {
      id: 'inbox.delete',
      title: m.inbox.delete,
      group: 'list',
      keys: ['#', 'delete'],
      scope: 'list',
      when: () => focusedNotification() !== null,
      run: () => {
        const n = focusedNotification();
        if (n) deleteOne(n);
      },
    },
  ]);

  const onMarkAll = async () => {
    const n = unreadCount;
    const res = await markAll({});
    if (res.data) showFlag({ title: m.inbox.allRead(res.data.markAllNotificationsRead || n), severity: 'success' });
  };

  const setPreset = (p: Preset) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (p === 'all') next.delete('preset');
        else next.set('preset', p);
        return next;
      },
      { replace: true },
    );

  const firstLoad = !data && loading;
  const errorMsg = error && !data ? describeError(error).message : null;

  const tabs = (
    <PresetTabs
      aria-label={m.inbox.presetTabs}
      value={preset}
      onChange={setPreset}
      tabs={PRESETS.map((p) => ({ id: p, label: m.inbox.presets[p], count: p === 'unread' ? unreadCount : null }))}
    />
  );
  const actions = (
    <Button size="md" iconBefore={<Icon name="check" />} disabled={unreadCount === 0} onClick={() => void onMarkAll()} data-testid="mark-all-read">
      <span className="hidden sm:inline">{m.inbox.markAllRead}</span>
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inbox">
      <ViewHeader title={m.inbox.title} icon={<Icon name="inbox" className="text-fg-subtle" />} create={false} actions={actions}>
        {tabs}
      </ViewHeader>
      <div className="@container scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {firstLoad ? (
          <InboxSkeleton />
        ) : errorMsg ? (
          <div className="p-5">
            <InlineMessage appearance="error" title={m.inbox.loadFailed} action={<Button size="sm" onClick={() => void refetch()}>{m.common.retry}</Button>}>
              {errorMsg}
            </InlineMessage>
          </div>
        ) : sections.length === 0 ? (
          <EmptyState icon="inbox" message={m.inbox.emptyPreset[preset]} fill />
        ) : (
          <div ref={listRef} role="grid" aria-label={m.inbox.list} aria-rowcount={order.length}>
            {sections.map((s) => (
              <div key={s.key} role="rowgroup" aria-label={s.label}>
                <div role="presentation" className="sticky top-0 z-10 flex h-7 items-center gap-2 border-b border-border bg-sunken px-5 text-sm font-medium text-fg-subtle">
                  <span>{s.label}</span>
                  <span className="text-xs text-fg-subtlest">{s.items.length}</span>
                </div>
                {s.items.map((n) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    tabStop={n.id === tabStopId}
                    selected={Boolean(panelIssueId && n.issue?.id === panelIssueId)}
                    onFocus={() => setFocusedId(n.id)}
                    onOpen={() => open(n)}
                    onToggleRead={() => setRead(n.id, Boolean(!n.readAt))}
                    onDelete={() => deleteOne(n)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function adjustUnread(cache: ApolloCache<unknown>, delta: number) {
  if (delta === 0) return;
  cache.modify({ fields: { unreadNotificationCount: (n: number) => Math.max(0, (n ?? 0) + delta) } });
}

interface RowProps {
  n: Notification;
  tabStop: boolean;
  selected: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}

function NotificationRow({ n, tabStop, selected, onFocus, onOpen, onToggleRead, onDelete }: RowProps) {
  const unread = !n.readAt;
  const summary = summaryOf(n);
  return (
    <div
      role="row"
      tabIndex={tabStop ? 0 : -1}
      data-notification-row={n.id}
      aria-selected={selected}
      aria-label={`${unread ? `${m.inbox.unreadLabel}. ` : ''}${n.issue ? `${n.issue.identifier} ${n.issue.title}. ` : ''}${summary}`}
      onFocus={onFocus}
      onClick={onOpen}
      className={clsx(
        'group relative flex h-10 cursor-pointer items-center gap-3 border-b border-border px-5 transition-colors duration-100 hover:bg-hover focus-visible:bg-hover',
        selected && 'bg-primary-subtle hover:bg-primary-subtle',
      )}
    >
      <div role="gridcell" className="flex min-w-0 flex-1 items-center gap-3">
        <span aria-hidden="true" className={clsx('h-2 w-2 shrink-0 rounded-full', unread ? 'bg-primary' : 'bg-transparent')} data-testid={unread ? 'unread-dot' : undefined} />
        <TypeIcon n={n} />
        {n.actor ? <Avatar name={n.actor.name} src={n.actor.avatarUrl} size={20} /> : <span className="h-5 w-5 shrink-0" />}
        {n.issue ? <span className="identifier w-16 shrink-0 truncate">{n.issue.identifier}</span> : null}
        <span className={clsx('min-w-0 flex-1 truncate text-base', unread ? 'font-medium text-fg' : 'text-fg-subtle')}>{n.issue?.title ?? summary}</span>
        {n.issue ? <span className="hidden max-w-60 shrink-0 truncate text-sm text-fg-subtle @2xl:block">{summary}</span> : null}
      </div>
      <div role="gridcell" className="flex w-16 shrink-0 items-center justify-end">
        <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)} className="text-sm text-fg-subtlest group-hover:hidden">
          {formatRelative(n.createdAt)}
        </time>
        <span className="hidden items-center gap-0.5 group-hover:flex">
          <IconButton
            label={unread ? m.inbox.markRead : m.inbox.markUnread}
            size="sm"
            tabIndex={-1}
            icon={<Icon name="check" />}
            onClick={(e) => {
              e.stopPropagation();
              onToggleRead();
            }}
          />
          <IconButton
            label={m.inbox.delete}
            size="sm"
            tabIndex={-1}
            icon={<Icon name="trash" />}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          />
        </span>
      </div>
    </div>
  );
}
