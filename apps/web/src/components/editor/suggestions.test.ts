import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import type { SearchIssue, SuggestionOwner, SuggestionPopupModel, SuggestionSources, MemberSuggestion } from './suggestions';
import { applyIssueReference, applyMention, closeSuggestions, isSuggestionOpen } from './suggestions';
import { createEditorExtensions } from './markdownExtensions';

const MEMBERS: MemberSuggestion[] = [
  { id: 'u-alice', name: 'Alice Ng', username: 'alice', avatarUrl: null },
  { id: 'u-bob', name: 'Bob Stone', username: 'bob', avatarUrl: null },
];

const ISSUE = {
  id: '0f3c2a1e-0000-4000-8000-000000000001',
  identifier: 'ENG-123',
  title: 'Fix login redirect',
  teamId: 't1',
  priority: 2,
  status: { id: 's1', name: 'Todo', category: 'todo', color: 'grey', order: 1, description: null, teamId: 't1' },
} as unknown as SearchIssue;

type Published = { owner: SuggestionOwner; popup: SuggestionPopupModel | null };

// jsdom has no layout. ProseMirror measures the caret whenever a transaction scrolls the selection into view,
// so give Range and Element the (empty) measurement methods it probes.
const noRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
const noBox = () => new DOMRect(0, 0, 0, 0);
for (const proto of [Range.prototype, Element.prototype]) {
  if (!('getClientRects' in proto)) Object.assign(proto, { getClientRects: noRects });
  if (!('getBoundingClientRect' in proto)) Object.assign(proto, { getBoundingClientRect: noBox });
}

let editors: Editor[] = [];
let published: Published[];
const searchIssues = vi.fn((query: string): Promise<SearchIssue[]> => Promise.resolve(query ? [ISSUE] : []));

/** Attached to the document so key events bubble the way they do in the app. */
function makeEditor(content = ''): Editor {
  const element = document.body.appendChild(document.createElement('div'));
  const sources: SuggestionSources = {
    getMembers: () => MEMBERS,
    searchIssues,
    publish: (owner, popup) => published.push({ owner, popup }),
  };
  const editor = new Editor({
    element,
    extensions: createEditorExtensions({ placeholder: '', sources }),
    content,
    contentType: 'markdown',
  });
  editors.push(editor);
  return editor;
}

/** Lets TipTap's async suggestion updates land. */
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function typeText(editor: Editor, text: string): void {
  editor.view.dispatch(editor.state.tr.insertText(text));
}

function press(editor: Editor, key: string, init: KeyboardEventInit = {}): boolean {
  return editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

/** The most recent list published for `owner`, or null when that list is closed. */
function lastPopup(owner: SuggestionOwner): SuggestionPopupModel | null {
  const entries = published.filter((p) => p.owner === owner);
  return entries.at(-1)?.popup ?? null;
}

beforeEach(() => {
  published = [];
  searchIssues.mockClear();
});

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.innerHTML = '';
});

describe('slash menu', () => {
  it('opens at the start of a line with every command', async () => {
    const editor = makeEditor();
    typeText(editor, '/');
    await settle();
    const popup = lastPopup('slash');
    expect(popup?.options.map((o) => o.value)).toEqual([
      'heading1',
      'heading2',
      'heading3',
      'bulletList',
      'orderedList',
      'taskList',
      'blockquote',
      'codeBlock',
      'divider',
    ]);
    expect(popup?.options[0]?.label).toBe('Heading 1');
    expect(isSuggestionOpen(editor.state)).toBe(true);
  });

  it('filters as the user types and applies the highlighted command with Enter', async () => {
    const editor = makeEditor('Intro');
    editor.commands.focus('end');
    typeText(editor, ' ');
    typeText(editor, '/');
    typeText(editor, 'hea');
    await settle();
    expect(lastPopup('slash')?.options.map((o) => o.value)).toEqual(['heading1', 'heading2', 'heading3']);
    press(editor, 'ArrowDown');
    press(editor, 'Enter');
    await settle();
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(editor.getText().trim()).toBe('Intro');
    expect(isSuggestionOpen(editor.state)).toBe(false);
  });

  it('does not open in the middle of a word', async () => {
    const editor = makeEditor();
    typeText(editor, 'and/or');
    await settle();
    expect(lastPopup('slash')).toBeNull();
  });

  it('closes when nothing matches', async () => {
    const editor = makeEditor();
    typeText(editor, '/zzz');
    await settle();
    expect(lastPopup('slash')).toBeNull();
    expect(isSuggestionOpen(editor.state)).toBe(false);
  });

  it('Esc closes only the list: the key is consumed and does not reach the document', async () => {
    const editor = makeEditor();
    const documentSpy = vi.fn();
    document.addEventListener('keydown', documentSpy);
    try {
      typeText(editor, '/');
      await settle();
      const notCancelled = press(editor, 'Escape');
      await settle();
      expect(notCancelled).toBe(false); // default prevented, so the global shortcut engine ignores it
      expect(documentSpy).not.toHaveBeenCalled();
      expect(lastPopup('slash')).toBeNull();
      expect(isSuggestionOpen(editor.state)).toBe(false);
    } finally {
      document.removeEventListener('keydown', documentSpy);
    }
  });

  it('Cmd/Ctrl+Enter while the list is open neither breaks the line nor submits', async () => {
    const editor = makeEditor();
    typeText(editor, '/');
    await settle();
    const before = editor.getJSON();
    press(editor, 'Enter', { metaKey: true });
    await settle();
    expect(editor.getJSON()).toEqual(before);
    expect(isSuggestionOpen(editor.state)).toBe(true);
  });

  it('is hidden inside code blocks', async () => {
    const editor = makeEditor();
    editor.commands.setCodeBlock();
    typeText(editor, '/');
    await settle();
    expect(lastPopup('slash')).toBeNull();
  });
});

describe('member mentions', () => {
  it('lists members for @ and inserts @username on Enter', async () => {
    const editor = makeEditor();
    typeText(editor, '@');
    await settle();
    expect(lastPopup('mention')?.options.map((o) => o.label)).toEqual(['Alice Ng', 'Bob Stone']);
    typeText(editor, 'bo');
    await settle();
    expect(lastPopup('mention')?.options.map((o) => o.value)).toEqual(['u-bob']);
    press(editor, 'Enter');
    await settle();
    expect(editor.getMarkdown().trim()).toBe('@bob');
    expect(lastPopup('mention')).toBeNull();
  });
});

describe('issue references', () => {
  it('searches the palette query for the typed text and inserts a link to the issue route', async () => {
    const editor = makeEditor();
    typeText(editor, '#');
    await settle(200); // the suggestion waits 150ms before searching
    expect(searchIssues).not.toHaveBeenCalled();
    typeText(editor, 'login');
    await settle(200);
    expect(searchIssues).toHaveBeenLastCalledWith('login');
    expect(lastPopup('issue')?.options.map((o) => o.label)).toEqual(['ENG-123 Fix login redirect']);
    press(editor, 'Enter');
    await settle();
    expect(editor.getMarkdown().trim()).toBe(`[ENG-123](/issue/${ISSUE.id})`);
  });

  it('does not open for a bare # trigger', async () => {
    const editor = makeEditor();
    typeText(editor, '#');
    await settle(200);
    expect(lastPopup('issue')).toBeNull();
  });
});

describe('suggestion inserts', () => {
  it('applyMention writes the plain @username the server parses', () => {
    const editor = makeEditor('Thanks for the fix');
    applyMention(editor, { from: 8, to: 8 }, 'alice');
    expect(editor.getMarkdown()).toBe('Thanks @alice for the fix');
  });

  it('applyIssueReference inserts a link mark with the identifier as text', () => {
    const editor = makeEditor('See');
    applyIssueReference(editor, { from: 4, to: 4 }, ISSUE);
    const link = editor.getJSON().content?.[0]?.content?.find((n) => n.marks?.some((mk) => mk.type === 'link'));
    expect(link).toMatchObject({ text: 'ENG-123', marks: [{ type: 'link', attrs: { href: `/issue/${ISSUE.id}` } }] });
  });

  it('closeSuggestions dismisses an open list', async () => {
    const editor = makeEditor();
    typeText(editor, '/');
    await settle();
    closeSuggestions(editor.view);
    await settle();
    expect(isSuggestionOpen(editor.state)).toBe(false);
    expect(lastPopup('slash')).toBeNull();
  });
});
