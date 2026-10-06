import type { MouseEvent } from 'react';
import { useSelection } from '@/stores/selection';
import { useUi } from '@/stores/ui';

/**
 * `Space` peeks (U1) only when focus sits on a row or a plain container. On a button,
 * link, checkbox or menu item, Space keeps its native meaning (activate).
 */
export function spaceTargetOk(active: Element | null = typeof document === 'undefined' ? null : document.activeElement): boolean {
  if (!active || active === document.body) return true;
  if (active instanceof HTMLElement && active.dataset.issueRow !== undefined) return true;
  if (active.closest('button, a[href], input, textarea, select, summary, [contenteditable="true"], [role="button"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [role="tab"]')) return false;
  return true;
}

export const CONTEXT_ANCHOR_ID = 'context-anchor';

/** Point the shared context-menu anchor at the pointer (right-click), or at `fallback`. */
export function contextAnchorAt(e: Pick<MouseEvent, 'clientX' | 'clientY'> | null, fallback: HTMLElement | null): HTMLElement | null {
  const anchor = typeof document === 'undefined' ? null : document.getElementById(CONTEXT_ANCHOR_ID);
  // Keyboard-invoked context menus (Shift+F10, Menu key) report 0,0: anchor to the element.
  if (!anchor || !e || (e.clientX === 0 && e.clientY === 0)) return fallback;
  anchor.style.left = `${e.clientX}px`;
  anchor.style.top = `${e.clientY}px`;
  return anchor;
}

/**
 * Right-click on a list row or board card (U2): the issue context menu for the selection
 * when the row is part of it, else for that row alone.
 */
export function openRowContextMenu(issueId: string, e: MouseEvent<HTMLElement>): void {
  e.preventDefault();
  const selected = useSelection.getState().selected;
  const ids = selected.has(issueId) ? [...selected] : [issueId];
  const row = e.currentTarget;
  useUi.getState().openContextMenu({ issueIds: ids, anchor: contextAnchorAt(e, row.querySelector<HTMLElement>('.identifier') ?? row) });
}
