import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

export const PANEL_PARAM = 'issue';

/** Below 768px the panel becomes a route (SPEC §4.10.2). */
export function isNarrow(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

/**
 * Open an issue: in the right panel (`?issue=<uuid>`, deep-linkable and back-button
 * correct) or as a full page (`⌘Enter`, or narrow viewports).
 */
export function useOpenIssue() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  return useCallback(
    (id: string, opts: { fullPage?: boolean; identifier?: string } = {}) => {
      if (opts.fullPage || isNarrow() || location.pathname.startsWith('/issue/')) {
        navigate(`/issue/${opts.identifier ?? id}`);
        return;
      }
      const next = new URLSearchParams(params);
      if (next.get(PANEL_PARAM) === id) return;
      const replace = next.has(PANEL_PARAM);
      next.set(PANEL_PARAM, id);
      navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace });
    },
    [navigate, location.pathname, params],
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
