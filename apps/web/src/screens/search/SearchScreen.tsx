import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useQuery } from '@apollo/client';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { Avatar, Button, EmptyState, Icon, InlineMessage, Skeleton, Spinner, StatusIcon, TextField } from '@velocity/ui';
import { GlobalSearchDocument } from '@/gql/graphql';
import type { GlobalSearchQuery, SearchType } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { ViewHeader } from '@/components/shell/ViewHeader';
import { ProjectIcon, TeamIcon } from '@/components/common/EntityIcons';
import { useOpenIssue, usePanelIssueId } from '@/lib/navigation';
import { describeError } from '@/lib/errors';
import { useRecent } from '@/stores/recent';
import { m } from '@/i18n';

type Result = GlobalSearchQuery['search'][number];
const GROUP_ORDER: SearchType[] = ['issue', 'team', 'project', 'member', 'view'];
const DEBOUNCE_MS = 150;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wrap matched query terms in <mark>. */
export function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map(escapeRegExp);
  if (terms.length === 0) return text;
  const re = new RegExp(`(${terms.join('|')})`, 'ig');
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-primary-subtle px-0.5 text-fg">
        {p}
      </mark>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

function SearchSkeleton() {
  return (
    <div role="status" aria-label={m.common.loading} className="flex flex-col">
      <div className="px-5 py-2">
        <Skeleton width={72} height={12} />
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 px-5">
          <Skeleton width={16} height={16} />
          <Skeleton width={56} height={12} />
          <Skeleton width={`${24 + ((i * 31) % 40)}%`} height={12} />
        </div>
      ))}
    </div>
  );
}

/** Global search (SPEC §4.11.8): grouped, keyboard-navigable results for the `q` in the URL. */
export function SearchScreen() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const ws = useWorkspace();
  const openIssue = useOpenIssue();
  const panelIssueId = usePanelIssueId();
  const q = params.get('q') ?? '';
  const debounced = useDebounced(q.trim(), DEBOUNCE_MS);
  const recent = useRecent((s) => s.searches);
  const pushSearch = useRecent((s) => s.pushSearch);
  const clearSearches = useRecent((s) => s.clearSearches);
  const listRef = useRef<HTMLDivElement>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const skip = debounced === '';
  // Issues are numerous; query them separately so teams, projects, members and views are never crowded out.
  const issuesQ = useQuery(GlobalSearchDocument, { variables: { query: debounced, limit: 30, types: ['issue'] }, skip, fetchPolicy: 'cache-and-network' });
  const othersQ = useQuery(GlobalSearchDocument, { variables: { query: debounced, limit: 24, types: ['team', 'project', 'member', 'view'] }, skip, fetchPolicy: 'cache-and-network' });
  const data = issuesQ.data && othersQ.data ? { search: [...issuesQ.data.search, ...othersQ.data.search] } : undefined;
  const previousData =
    issuesQ.previousData && othersQ.previousData ? { search: [...issuesQ.previousData.search, ...othersQ.previousData.search] } : undefined;
  const loading = issuesQ.loading || othersQ.loading;
  const error = issuesQ.error ?? othersQ.error;
  const refetch = () => Promise.all([issuesQ.refetch(), othersQ.refetch()]);
  const shown = debounced === '' ? undefined : (data ?? previousData);
  const pending = q.trim() !== debounced || (loading && Boolean(shown));

  const groups = useMemo(() => {
    const out = new Map<SearchType, Result[]>();
    for (const r of shown?.search ?? []) {
      const list = out.get(r.type) ?? [];
      list.push(r);
      out.set(r.type, list);
    }
    return GROUP_ORDER.flatMap((t) => (out.has(t) ? [{ type: t, items: out.get(t) ?? [] }] : []));
  }, [shown]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const tabStopKey = focusedKey && flat.some((r) => `${r.type}:${r.id}` === focusedKey) ? focusedKey : flat[0] ? `${flat[0].type}:${flat[0].id}` : null;

  const open = useCallback(
    (r: Result) => {
      pushSearch(q);
      switch (r.type) {
        case 'issue':
          if (r.issue) openIssue(r.issue.id, { identifier: r.issue.identifier });
          break;
        case 'team':
          if (r.team) navigate(`/team/${r.team.key}/active`);
          break;
        case 'project':
          if (r.project) navigate(`/project/${r.project.id}`);
          break;
        case 'member':
          if (r.user) navigate(`/issues?filter=${encodeURIComponent(`assignee:${r.user.username}`)}`);
          break;
        case 'view':
          if (r.view) navigate(`/view/${r.view.slug}`);
          break;
      }
    },
    [navigate, openIssue, pushSearch, q],
  );

  const focusKey = (key: string) => {
    setFocusedKey(key);
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-result="${CSS.escape(key)}"]`);
      el?.focus();
      el?.scrollIntoView({ block: 'nearest' });
    });
  };

  const move = (delta: 1 | -1, from: string | null) => {
    if (flat.length === 0) return;
    const keys = flat.map((r) => `${r.type}:${r.id}`);
    const cur = from ? keys.indexOf(from) : -1;
    const next = keys[cur === -1 ? (delta === 1 ? 0 : keys.length - 1) : Math.max(0, Math.min(keys.length - 1, cur + delta))];
    if (next) focusKey(next);
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-result]')?.getAttribute('data-result') ?? null;
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      move(1, key);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      move(-1, key);
    } else if (e.key === 'Enter' && key) {
      e.preventDefault();
      const r = flat.find((x) => `${x.type}:${x.id}` === key);
      if (r) open(r);
    }
  };

  // The query input lives in the sidebar: ↓ jumps into the results, Enter opens the first one.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || t.id !== 'sidebar-search') return;
      if (e.key === 'ArrowDown' && flat.length > 0) {
        e.preventDefault();
        move(1, null);
      } else if (e.key === 'Enter' && flat[0]) {
        e.preventDefault();
        open(flat[0]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const setQ = (value: string) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set('q', value);
    return next;
  }, { replace: true });

  const firstLoad = debounced !== '' && !shown && loading;
  const errorMsg = error && !shown ? describeError(error).message : null;

  const header = (
    <ViewHeader
      title={m.search.title}
      icon={<Icon name="search" className="text-fg-subtle" />}
      create={false}
      actions={pending ? <Spinner size={16} label={m.search.searching} /> : null}
    >
      {debounced !== '' ? <span className="truncate pl-1 text-base text-fg-subtle">“{debounced}”</span> : null}
    </ViewHeader>
  );

  let body: ReactNode;
  if (q.trim() === '') {
    body =
      recent.length > 0 ? (
        <div className="py-2">
          <div className="flex h-7 items-center justify-between px-5">
            <h2 className="text-sm font-medium text-fg-subtle">{m.search.recent}</h2>
            <Button size="sm" variant="subtle" onClick={clearSearches}>
              {m.search.clearRecent}
            </Button>
          </div>
          <ul>
            {recent.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => setQ(s)}
                  className="flex h-9 w-full items-center gap-3 px-5 text-left text-base text-fg hover:bg-hover"
                >
                  <Icon name="search" className="text-fg-subtlest" />
                  <span className="truncate">{s}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState icon="search" message={m.search.empty} className="py-16" />
      );
  } else if (firstLoad || (!shown && !error)) {
    body = <SearchSkeleton />;
  } else if (errorMsg) {
    body = (
      <div className="p-5">
        <InlineMessage appearance="error" title={m.search.failed} action={<Button size="sm" onClick={() => void refetch()}>{m.common.retry}</Button>}>
          {errorMsg}
        </InlineMessage>
      </div>
    );
  } else if (groups.length === 0) {
    body = <EmptyState icon="search" message={m.search.noResults(debounced)} className="py-16" />;
  } else {
    body = (
      <div ref={listRef} role="grid" aria-label={m.search.results} onKeyDown={onListKeyDown} className={clsx('pb-4', pending && 'opacity-80')}>
        {groups.map((g) => (
          <div key={g.type} role="rowgroup" aria-label={m.search.groups[g.type]}>
            <div role="presentation" className="sticky top-0 z-10 flex h-7 items-center gap-2 border-b border-border bg-sunken px-5 text-sm font-medium text-fg-subtle">
              <h2 className="text-sm font-medium">{m.search.groups[g.type]}</h2>
              <span className="text-xs text-fg-subtlest">{g.items.length}</span>
            </div>
            {g.items.map((r) => {
              const key = `${r.type}:${r.id}`;
              return (
                <ResultRow
                  key={key}
                  r={r}
                  query={debounced}
                  tabStop={key === tabStopKey}
                  selected={Boolean(r.issue && r.issue.id === panelIssueId)}
                  onFocus={() => setFocusedKey(key)}
                  onOpen={() => open(r)}
                  teamIcon={r.team ? ws.teamsById.get(r.team.id) : undefined}
                />
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="search-screen">
      {header}
      <div className="border-b border-border px-5 py-2 md:hidden">
        <TextField label={m.search.title} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={m.search.placeholder} />
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {body}
      </div>
    </div>
  );
}

interface RowProps {
  r: Result;
  query: string;
  tabStop: boolean;
  selected: boolean;
  onFocus: () => void;
  onOpen: () => void;
  teamIcon?: { key: string; color: import('@/gql/graphql').PaletteColor; icon?: string | null };
}

function ResultRow({ r, query, tabStop, selected, onFocus, onOpen, teamIcon }: RowProps) {
  let lead: ReactNode = null;
  let primary: ReactNode = <Highlight text={r.title} query={query} />;
  let meta: ReactNode = null;
  switch (r.type) {
    case 'issue':
      if (r.issue) {
        lead = <StatusIcon category={r.issue.status.category} color={r.issue.status.color} label={r.issue.status.name} />;
        meta = <span className="identifier">{r.issue.identifier}</span>;
        primary = <Highlight text={r.issue.title} query={query} />;
      }
      break;
    case 'team':
      lead = teamIcon ? <TeamIcon team={teamIcon} /> : <Icon name="team" className="text-fg-subtle" />;
      meta = r.team ? <span className="identifier shrink-0">{r.team.key}</span> : null;
      break;
    case 'project':
      lead = r.project ? <ProjectIcon project={r.project} /> : <Icon name="project" className="text-fg-subtle" />;
      break;
    case 'member':
      lead = <Avatar name={r.user?.name ?? r.title} src={r.user?.avatarUrl} size={20} />;
      meta = r.user ? <span className="shrink-0 text-sm text-fg-subtlest">@{r.user.username}</span> : null;
      break;
    case 'view':
      lead = <Icon name="view" className="text-fg-subtle" />;
      break;
  }
  return (
    <div
      role="row"
      tabIndex={tabStop ? 0 : -1}
      data-result={`${r.type}:${r.id}`}
      aria-selected={selected}
      onFocus={onFocus}
      onClick={onOpen}
      className={clsx(
        'flex h-9 cursor-pointer items-center gap-3 px-5 hover:bg-hover focus-visible:bg-hover',
        selected && 'bg-primary-subtle hover:bg-primary-subtle',
      )}
    >
      <div role="gridcell" className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex w-5 shrink-0 items-center justify-center">{lead}</span>
        {r.type === 'issue' ? <span className="w-16 shrink-0">{meta}</span> : null}
        <span className="min-w-0 truncate text-base text-fg">{primary}</span>
        {r.type !== 'issue' ? meta : null}
      </div>
    </div>
  );
}
