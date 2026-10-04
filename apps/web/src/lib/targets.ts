import { activeRegion } from '@/keyboard/react';
import { useActiveList } from '@/stores/list';
import { useDetailIssue } from '@/stores/detail';
import { useSelection } from '@/stores/selection';

/**
 * Which issues an action shortcut (S, A, L, P, E, Y, #…) applies to: the selection, else
 * the issue in the focused region (panel/page or the focused list row).
 */
export function targetIssueIds(): string[] {
  const selected = useSelection.getState().selected;
  if (selected.size > 0) return [...selected];
  const detail = useDetailIssue.getState().issueId;
  const focused = useActiveList.getState().focusedId;
  if (activeRegion() === 'panel' && detail) return [detail];
  if (focused) return [focused];
  if (detail) return [detail];
  return [];
}

/** Element to anchor a shortcut popup to: the focused row or the matching panel property. */
export function targetAnchor(property?: string): HTMLElement | null {
  const region = activeRegion();
  if (region === 'panel' && property) {
    const el = document.querySelector<HTMLElement>(`[data-region="panel"] [data-testid="prop-${property}"]`);
    if (el) return el;
  }
  const focused = useActiveList.getState().focusedId;
  if (focused) {
    const row = document.querySelector<HTMLElement>(`[data-issue-row="${CSS.escape(focused)}"]`);
    if (row) return row.querySelector<HTMLElement>('.identifier') ?? row;
  }
  if (property) {
    const el = document.querySelector<HTMLElement>(`[data-testid="prop-${property}"]`);
    if (el) return el;
  }
  return document.getElementById('picker-anchor');
}
