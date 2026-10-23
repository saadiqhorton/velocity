import { m } from '@/i18n';

/**
 * Compact drag image for issue rows and cards: the identifier and title, or the count for a
 * multi-selection. The browser snapshots the element once dragstart returns, so it is removed
 * on the next tick.
 */
export function setIssueDragPreview(e: { dataTransfer: DataTransfer | null }, issue: { identifier: string; title: string }, count: number): void {
  const el = document.createElement('div');
  el.className = 'pointer-events-none fixed w-60 rounded-sm border border-border bg-overlay px-2.5 py-1.5 text-base text-fg shadow-overlay';
  // Off the visible page: the element only exists to be snapshotted.
  el.style.top = '-1000px';
  el.style.left = '-1000px';
  if (count > 1) {
    el.textContent = m.list.count(count);
  } else {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    const identifier = document.createElement('span');
    identifier.className = 'identifier shrink-0';
    identifier.textContent = issue.identifier;
    const title = document.createElement('span');
    title.className = 'truncate font-medium';
    title.textContent = issue.title;
    row.append(identifier, title);
    el.append(row);
  }
  document.body.append(el);
  e.dataTransfer?.setDragImage(el, 16, 16);
  window.setTimeout(() => el.remove(), 0);
}
