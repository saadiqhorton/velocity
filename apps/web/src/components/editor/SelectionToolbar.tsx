import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { useEditorState } from '@tiptap/react';
import { IconButton, Icon } from '@velocity/ui';
import { formatBinding, isMacPlatform } from '@/keyboard/engine';
import { m } from '@/i18n';
import { isSuggestionOpen } from './suggestions';
import { normalizeLinkHref } from './suggestionItems';

const MAC = isMacPlatform();
/** Key caps for a binding, platform-aware, for the tooltip. */
const keyCaps = (binding: string): string[] => formatBinding(binding, MAC).flat();

/**
 * Shown for a non-empty text selection (outside code blocks and while a `/`, `@` or `#` list is open).
 * The bubble is positioned by TipTap's BubbleMenu; its own mousedown is cancelled so the selection survives.
 */
export function shouldShowSelectionToolbar({
  editor,
  element,
  view,
  state,
}: {
  editor: Editor;
  element: HTMLElement;
  view: EditorView;
  state: EditorState;
}): boolean {
  const { selection } = state;
  if (!editor.isEditable || !(selection instanceof TextSelection) || selection.empty) return false;
  if (state.doc.textBetween(selection.from, selection.to).trim().length === 0) return false;
  if (editor.isActive('codeBlock') || isSuggestionOpen(state)) return false;
  return view.hasFocus() || element.contains(document.activeElement);
}

export function SelectionToolbar({ editor }: { editor: Editor }) {
  const marks = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      href: (e.getAttributes('link').href as string | undefined) ?? '',
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (linkOpen) inputRef.current?.focus();
  }, [linkOpen]);

  const openLink = () => {
    setHref(marks.href);
    setLinkOpen(true);
  };

  const cancelLink = () => {
    setLinkOpen(false);
    editor.commands.focus();
  };

  /** Enter applies the URL; an empty field removes the link. An unsafe scheme keeps the field open. */
  const applyLink = () => {
    const next = normalizeLinkHref(href);
    if (href.trim() && next === null) return;
    const chain = editor.chain().focus().extendMarkRange('link');
    if (next) chain.setLink({ href: next }).run();
    else chain.unsetLink().run();
    setLinkOpen(false);
  };

  return (
    <div
      role="toolbar"
      aria-label={m.editor.formatting}
      data-selection-toolbar=""
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setLinkOpen(false);
      }}
      className="flex items-center gap-0.5 rounded-md border border-border bg-overlay p-1 text-fg shadow-overlay"
    >
      <IconButton
        label={m.editor.bold}
        shortcut={keyCaps('mod+b')}
        size="sm"
        aria-pressed={marks.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
        icon={<span className="text-base font-bold">B</span>}
      />
      <IconButton
        label={m.editor.italic}
        shortcut={keyCaps('mod+i')}
        size="sm"
        aria-pressed={marks.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        icon={<span className="text-base italic">I</span>}
      />
      <IconButton
        label={m.editor.strike}
        shortcut={keyCaps('mod+shift+s')}
        size="sm"
        aria-pressed={marks.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        icon={<span className="text-base line-through">S</span>}
      />
      <IconButton
        label={m.editor.inlineCode}
        shortcut={keyCaps('mod+e')}
        size="sm"
        aria-pressed={marks.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
        icon={<Icon name="code" />}
      />
      <IconButton
        label={m.editor.link}
        size="sm"
        aria-pressed={marks.link}
        onClick={openLink}
        icon={<Icon name="link" />}
      />
      {linkOpen ? (
        <input
          ref={inputRef}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-label={m.editor.linkUrl}
          value={href}
          onChange={(e) => setHref(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              applyLink();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              cancelLink();
            }
          }}
          className="ml-1 h-8 w-64 min-w-0 rounded-sm border border-border bg-raised px-2 text-base text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus"
        />
      ) : null}
    </div>
  );
}
