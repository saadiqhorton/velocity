import type { EditorView } from '@tiptap/pm/view';

const INTERNAL_URL_BASE = 'https://velocity.invalid';

export interface EditorLinkActions {
  navigate: (href: string) => void;
  openExternal: (href: string) => void;
}

/** Opens an already validated HTTP(S) URL without exposing the app window to the destination. */
export function openExternalEditorLink(href: string): void {
  window.open(href, '_blank', 'noopener,noreferrer');
}

type LinkTarget = { kind: 'internal'; href: string } | { kind: 'external'; href: string };

function resolveEditorLinkTarget(
  view: Pick<EditorView, 'dom'>,
  event: MouseEvent,
): LinkTarget | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null;
  }

  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest<HTMLAnchorElement>('a');
  if (!anchor || !view.dom.contains(anchor)) return null;

  // Read the authored value rather than `HTMLAnchorElement.href`, which resolves relative URLs and can
  // turn malformed or non-navigable values into an apparently valid absolute URL.
  const rawHref = anchor.getAttribute('href');
  if (!rawHref || rawHref.startsWith('//')) return null;

  if (rawHref.startsWith('/')) {
    try {
      const url = new URL(rawHref, INTERNAL_URL_BASE);
      if (url.origin !== INTERNAL_URL_BASE) return null;
      return { kind: 'internal', href: `${url.pathname}${url.search}${url.hash}` };
    } catch {
      return null;
    }
  }

  try {
    const url = new URL(rawHref);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { kind: 'external', href: url.href };
  } catch {
    return null;
  }
}

/** Route links in an editable rich-text field without changing normal text editing. */
export function activateEditorLink(
  view: Pick<EditorView, 'dom'>,
  event: MouseEvent,
  actions: EditorLinkActions,
): boolean {
  const target = resolveEditorLinkTarget(view, event);
  if (!target) return false;

  event.preventDefault();
  if (target.kind === 'internal') actions.navigate(target.href);
  else actions.openExternal(target.href);
  return true;
}
