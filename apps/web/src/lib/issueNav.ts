/**
 * List context for the full issue page (Roadmap v1.2 U1).
 *
 * When an issue opens from a list, the page needs to know which list it came from so it
 * can show `n / total`, step with J/K, and return to the same scroll position and row.
 * The context travels in the history entry's state (it survives reloads and back/forward)
 * and is rebuilt on the page from the same query variables, so it hits the Apollo cache.
 */
import { create } from 'zustand';
import type { DisplayState } from './viewState';
import type { IssueListScope } from '@/components/issues/useIssueList';

/** Everything `useIssueList` needs to reproduce a list's order. Plain JSON. */
export interface ListNavParams {
  scope: IssueListScope;
  filter: string;
  display: DisplayState;
  allGroupKeys?: (string | null)[];
  collapsed: string[];
  eagerLimit?: number;
}

export interface ListNavSource {
  listId: string;
  /** Breadcrumb label for the list (team, project or view name). */
  label: string;
  /** Path + search of the list, without the peek (`?issue=`) parameter. */
  returnTo: string;
  params: ListNavParams;
}

export interface IssueNavState {
  source: ListNavSource;
  /** Issue pages pushed on top of the first one (sub-issue and relation links). */
  depth: number;
}

/** History-state key; kept short because it lives in `history.state`. */
export const NAV_STATE_KEY = 'issueNav';

export function readNavState(state: unknown): IssueNavState | null {
  if (!state || typeof state !== 'object') return null;
  const nav = (state as Record<string, unknown>)[NAV_STATE_KEY];
  if (!nav || typeof nav !== 'object') return null;
  const n = nav as Partial<IssueNavState>;
  const s = n.source;
  if (!s || typeof s.listId !== 'string' || typeof s.returnTo !== 'string' || !s.params || typeof s.params.filter !== 'string') return null;
  return { source: s, depth: typeof n.depth === 'number' && n.depth >= 0 ? n.depth : 0 };
}

export function navStateFor(nav: IssueNavState | null): Record<string, unknown> | undefined {
  return nav ? { [NAV_STATE_KEY]: nav } : undefined;
}

/** Lists register how to rebuild themselves while mounted (ListScreen). */
interface SourceState {
  sources: Record<string, ListNavSource>;
  register: (source: ListNavSource) => void;
  unregister: (listId: string) => void;
}

export const useListSources = create<SourceState>()((set) => ({
  sources: {},
  register: (source) => set((s) => ({ sources: { ...s.sources, [source.listId]: source } })),
  unregister: (listId) =>
    set((s) => {
      if (!(listId in s.sources)) return s;
      const next = { ...s.sources };
      delete next[listId];
      return { sources: next };
    }),
}));

/** Strip the peek parameter so the return path is the list itself. */
export function listReturnPath(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('issue');
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

/**
 * Scroll and focus to restore when a list mounts again after the issue page. Written when
 * an issue opens from the list (and updated while stepping), consumed once on return.
 */
export interface ListMemory {
  returnTo: string;
  scrollTop: number;
  focusedId: string | null;
}

const memory = new Map<string, ListMemory>();

export function rememberList(listId: string, entry: ListMemory): void {
  memory.set(listId, entry);
}

export function updateListFocus(listId: string, focusedId: string): void {
  const entry = memory.get(listId);
  if (entry) memory.set(listId, { ...entry, focusedId });
}

/**
 * The memory for a list, only if it belongs to the current location. Read during render
 * (pure, so StrictMode's double render sees the same value); `forgetListMemory` once used.
 */
export function peekListMemory(listId: string, currentPath: string): ListMemory | null {
  const entry = memory.get(listId);
  return entry && entry.returnTo === currentPath ? entry : null;
}

export function forgetListMemory(listId: string): void {
  memory.delete(listId);
}

/** Test hook. */
export function clearListMemory(): void {
  memory.clear();
}
