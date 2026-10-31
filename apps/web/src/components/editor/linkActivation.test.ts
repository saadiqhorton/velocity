import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { activateEditorLink, openExternalEditorLink } from './linkActivation';
import type { EditorLinkActions } from './linkActivation';
import { createEditorExtensions } from './markdownExtensions';
import type { SuggestionSources } from './suggestions';

const ISSUE_HREF = '/issue/0f3c2a1e-0000-4000-8000-000000000001';
const sources: SuggestionSources = {
  getMembers: () => [],
  searchIssues: () => Promise.resolve([]),
  publish: () => undefined,
};

function mountAnchor(href?: string) {
  const root = document.createElement('div');
  const anchor = document.createElement('a');
  anchor.textContent = 'link';
  if (href !== undefined) anchor.setAttribute('href', href);
  root.append(anchor);
  document.body.append(root);
  return { root, anchor };
}

function click(anchor: Element, init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
}

function actions() {
  return {
    navigate: vi.fn<EditorLinkActions['navigate']>(),
    openExternal: vi.fn<EditorLinkActions['openExternal']>(),
  };
}

function activateAt(
  root: HTMLElement,
  anchor: Element,
  handled: EditorLinkActions,
  init: MouseEventInit = {},
): { event: MouseEvent; handled: boolean } {
  let event!: MouseEvent;
  let result = false;
  anchor.addEventListener('click', (current) => {
    event = current as MouseEvent;
    result = activateEditorLink({ dom: root }, event, handled);
  }, { once: true });
  // jsdom logs an unimplemented full-page navigation unless a test click is cancelled.
  anchor.addEventListener('click', (current) => current.preventDefault(), { once: true });
  anchor.dispatchEvent(click(anchor, init));
  return { event, handled: result };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('activateEditorLink', () => {
  it('routes a primary click on an internal path through the app router', () => {
    const { root, anchor } = mountAnchor(`${ISSUE_HREF}?issue=child#comment`);
    const handled = actions();
    const result = activateAt(root, anchor, handled);

    expect(result.handled).toBe(true);
    expect(result.event.defaultPrevented).toBe(true);
    expect(handled.navigate).toHaveBeenCalledOnce();
    expect(handled.navigate).toHaveBeenCalledWith(`${ISSUE_HREF}?issue=child#comment`);
    expect(handled.openExternal).not.toHaveBeenCalled();
  });

  it('opens an external HTTP(S) URL in a safe new context', () => {
    const { root, anchor } = mountAnchor('https://example.com/docs?q=1#install');
    const handled = actions();
    const result = activateAt(root, anchor, handled);

    expect(result.handled).toBe(true);
    expect(result.event.defaultPrevented).toBe(true);
    expect(handled.openExternal).toHaveBeenCalledOnce();
    expect(handled.openExternal).toHaveBeenCalledWith('https://example.com/docs?q=1#install');
    expect(handled.navigate).not.toHaveBeenCalled();
  });

  it('opens produced external destinations with noopener and noreferrer', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    openExternalEditorLink('https://example.com/docs?q=1#install');

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(
      'https://example.com/docs?q=1#install',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it.each([
    ['control', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['non-primary button', { button: 1 }],
  ])('leaves %s clicks to the browser', (_label, init) => {
    const { root, anchor } = mountAnchor(ISSUE_HREF);
    const handled = actions();

    expect(activateAt(root, anchor, handled, init).handled).toBe(false);
    expect(handled.navigate).not.toHaveBeenCalled();
    expect(handled.openExternal).not.toHaveBeenCalled();
  });

  it('leaves an already handled click alone', () => {
    const { root, anchor } = mountAnchor(ISSUE_HREF);
    const handled = actions();
    anchor.addEventListener('click', (event) => event.preventDefault(), { once: true });
    let event!: MouseEvent;
    let result = false;
    anchor.addEventListener('click', (current) => {
      event = current as MouseEvent;
      result = activateEditorLink({ dom: root }, event, handled);
    }, { once: true });
    anchor.dispatchEvent(click(anchor));

    expect(event.defaultPrevented).toBe(true);
    expect(result).toBe(false);
    expect(handled.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['missing href', undefined],
    ['fragment-only URL', '#section'],
    ['relative path without a root slash', 'issue/DEZ-72'],
    ['network path', '//example.com/phishing'],
    ['script URL', 'javascript:alert(1)'],
    ['non-web protocol', 'mailto:test@example.com'],
    ['malformed URL', 'https://['],
  ])('ignores a %s', (_label, href) => {
    const { root, anchor } = mountAnchor(href);
    const handled = actions();

    expect(activateAt(root, anchor, handled).handled).toBe(false);
    expect(handled.navigate).not.toHaveBeenCalled();
    expect(handled.openExternal).not.toHaveBeenCalled();
  });

  it('ignores a click target outside the editor', () => {
    const { root } = mountAnchor();
    const outside = document.createElement('a');
    outside.href = ISSUE_HREF;
    const handled = actions();

    expect(activateAt(root, outside, handled).handled).toBe(false);
    expect(handled.navigate).not.toHaveBeenCalled();
  });
});

describe('MarkdownEditor link integration', () => {
  it('uses the app click handler while the Link extension keeps normal editing clicks disabled', () => {
    const handled = actions();
    const editor = new Editor({
      extensions: createEditorExtensions({ placeholder: '', sources }),
      content: `[DEZ-72](${ISSUE_HREF})`,
      contentType: 'markdown',
      editorProps: {
        handleClick: (view, _pos, event) => activateEditorLink(view, event, handled),
      },
    });
    document.body.append(editor.view.dom);

    try {
      const linkExtension = editor.extensionManager.extensions.find((extension) => extension.name === 'link');
      expect(linkExtension?.options.openOnClick).toBe(false);
      const anchor = editor.view.dom.querySelector('a');
      expect(anchor?.textContent).toBe('DEZ-72');

      const event = click(anchor!);
      Object.defineProperty(event, 'target', { value: anchor });
      const handledByView = editor.view.someProp('handleClick', (handleClick) =>
        handleClick(editor.view, 1, event),
      );

      expect(handledByView).toBe(true);
      expect(handled.navigate).toHaveBeenCalledOnce();
      expect(handled.navigate).toHaveBeenCalledWith(ISSUE_HREF);
      expect(handled.openExternal).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
    }
  });
});
