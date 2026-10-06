import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { listReturnPath, navStateFor, readNavState, rememberList, useListSources } from './issueNav';
import type { IssueNavState } from './issueNav';

export const PANEL_PARAM = 'issue';

/** Below 768px the panel becomes a route (SPEC §4.10.2). */
export function isNarrow(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

export interface OpenIssueOptions {
  /** Path segment for the page URL (`ENG-123` reads better than a UUID). */
  identifier?: string;
  /** Open the side panel as a quick peek (`Space`) instead of the full page. */
  peek?: boolean;
  /** The list the issue was opened from: the page gets `n / total` and J/K for it. */
  fromList?: string;
  /** Scroll offset of that list, restored on return. */
  scrollTop?: number;
  /** Replace the current history entry (stepping through a list on the page). */
  replace?: boolean;
}

/**
 * Open an issue (Roadmap v1.2 U1). The full page (`/issue/:id`) is the default target;
 * `peek` opens the right panel (`?issue=<uuid>`, deep-linkable and back-button correct).
 * Inside an open panel, links keep walking the panel. Below 768px everything is a page.
 */
export function useOpenIssue() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  return useCallback(
    (id: string, opts: OpenIssueOptions = {}) => {
      const panelOpen = params.has(PANEL_PARAM);
      const onPage = location.pathname.startsWith('/issue/');
      if (!onPage && !isNarrow() && (opts.peek || (panelOpen && opts.fromList === undefined && opts.peek !== false))) {
        const next = new URLSearchParams(params);
        if (next.get(PANEL_PARAM) === id) return;
        const replace = next.has(PANEL_PARAM);
        next.set(PANEL_PARAM, id);
        navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace });
        return;
      }
      let nav: IssueNavState | null = null;
      if (opts.fromList) {
        const source = useListSources.getState().sources[opts.fromList];
        if (source) {
          nav = { source, depth: 0 };
          rememberList(source.listId, { returnTo: source.returnTo, scrollTop: opts.scrollTop ?? 0, focusedId: id });
        }
      } else if (onPage) {
        // Links on the page (sub-issues, relations) keep the list so Esc still returns to it.
        const current = readNavState(location.state);
        if (current) nav = { source: current.source, depth: opts.replace ? current.depth : current.depth + 1 };
      }
      navigate(`/issue/${opts.identifier ?? id}`, { state: navStateFor(nav), replace: opts.replace });
    },
    [navigate, location.pathname, location.state, params],
  );
}

export function useClosePanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  return useCallback(() => {
    if (!params.has(PANEL_PARAM)) return false;
    const next = new URLSearchParams(params);
    const id = next.get(PANEL_PARAM);
    next.delete(PANEL_PARAM);
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' });
    // Return focus to the row the panel was opened from (SPEC §4.12 focus rules).
    requestAnimationFrame(() => {
      const row = id ? document.querySelector<HTMLElement>(`[data-issue-row="${CSS.escape(id)}"]`) : null;
      (row ?? document.getElementById('main-content'))?.focus();
    });
    return true;
  }, [navigate, location.pathname, params]);
}

export function usePanelIssueId(): string | null {
  const [params] = useSearchParams();
  return params.get(PANEL_PARAM);
}

export { listReturnPath };
