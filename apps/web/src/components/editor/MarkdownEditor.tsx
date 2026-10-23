import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useApolloClient } from '@apollo/client';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import clsx from 'clsx';
import { useWorkspace } from '@/app/workspace';
import { GlobalSearchDocument } from '@/gql/graphql';
import { createEditorExtensions, editorMarkdown } from './markdownExtensions';
import { SelectionToolbar, shouldShowSelectionToolbar } from './SelectionToolbar';
import { SuggestionPopup } from './SuggestionPopup';
import { closeSuggestions, isSuggestionOpen } from './suggestions';
import type { SearchIssue, SuggestionPopupModel, SuggestionSources } from './suggestions';

/** A stable getter that returns the most recent `value` (for callbacks the editor is created with once). */
function useLatestValue<T>(value: T): () => T {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  return useCallback(() => latest.current, []);
}

export interface MarkdownEditorHandle {
  focus: () => void;
  clear: () => void;
  getMarkdown: () => string;
}

export interface MarkdownEditorProps {
  value: string;
  onChange?: (markdown: string) => void;
  onBlur?: (markdown: string) => void;
  /** ⌘/Ctrl+Enter (comment submit, SPEC §4.12). */
  onSubmit?: (markdown: string) => void;
  /** Esc returns focus to the list (SPEC §4.12 text-field rule). */
  onEscape?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel: string;
  className?: string;
  handle?: Ref<MarkdownEditorHandle>;
  minHeight?: 'sm' | 'md';
}

/**
 * Rich text over Markdown (SPEC §5.2: tiptap, markdown-serialized). Loaded lazily.
 * Tiptap's CSS injection is off: styles come from app.css so the strict CSP
 * (`style-src 'self' 'nonce-…'`) never needs an inline <style>.
 */
export default function MarkdownEditor({
  value,
  onChange,
  onBlur,
  onSubmit,
  onEscape,
  placeholder,
  autoFocus,
  ariaLabel,
  className,
  handle,
  minHeight = 'md',
}: MarkdownEditorProps) {
  const callbacks = useRef({ onChange, onBlur, onSubmit, onEscape });
  useEffect(() => {
    callbacks.current = { onChange, onBlur, onSubmit, onEscape };
  });

  // `/`, `@` and `#` menus read the workspace members and the palette's issue search (same GlobalSearch document).
  // The editor is created once, so the menus get stable functions that always return the latest members.
  const client = useApolloClient();
  const getMembers = useLatestValue(useWorkspace().activeUsers);
  const searchIssues = useCallback(
    (query: string): Promise<SearchIssue[]> =>
      client
        .query({ query: GlobalSearchDocument, variables: { query, limit: 8, types: ['issue'] }, fetchPolicy: 'cache-first' })
        .then(({ data }) => data.search.flatMap((row) => (row.issue ? [row.issue] : [])))
        .catch(() => []),
    [client],
  );
  const [suggestion, setSuggestion] = useState<SuggestionPopupModel | null>(null);
  const publish = useCallback<SuggestionSources['publish']>(
    (owner, popup) => setSuggestion((prev) => popup ?? (prev?.owner === owner ? null : prev)),
    [],
  );

  const editor = useEditor({
    extensions: createEditorExtensions({
      placeholder: placeholder ?? '',
      sources: {
        getMembers,
        searchIssues,
        publish,
      },
    }),
    content: value,
    contentType: 'markdown',
    injectCSS: false,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        role: 'textbox',
        class: clsx('prose-vel outline-none', minHeight === 'sm' ? 'min-h-10' : 'min-h-20'),
      },
      handleKeyDown: (view, event) => {
        // An open `/`, `@` or `#` list owns Enter and Esc (its plugin runs next and closes itself on Esc).
        if (isSuggestionOpen(view.state)) return false;
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && callbacks.current.onSubmit) {
          event.preventDefault();
          callbacks.current.onSubmit(editorRef.current ? editorMarkdown(editorRef.current) : '');
          return true;
        }
        if (event.key === 'Escape' && callbacks.current.onEscape) {
          event.preventDefault();
          callbacks.current.onEscape();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => callbacks.current.onChange?.(editorMarkdown(e)),
    onBlur: ({ editor: e, event }) => {
      closeSuggestions(e.view);
      // Focus moving into the selection toolbar (its link field) is not a blur of the field.
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-selection-toolbar]')) return;
      callbacks.current.onBlur?.(editorMarkdown(e));
    },
  });
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // External value changes (another member's edit) replace content when not focused.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    if (editorMarkdown(editor) !== value) editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);

  useImperativeHandle(
    handle,
    () => ({
      focus: () => editor?.commands.focus('end'),
      clear: () => editor?.commands.clearContent(true),
      getMarkdown: () => (editor ? editorMarkdown(editor) : ''),
    }),
    [editor],
  );

  return (
    <>
      <EditorContent editor={editor} className={clsx('text-base text-fg', className)} data-own-keys="" />
      {editor ? (
        <BubbleMenu editor={editor} shouldShow={shouldShowSelectionToolbar} style={{ zIndex: 'var(--ds-z-index-dropdown)' }}>
          <SelectionToolbar editor={editor} />
        </BubbleMenu>
      ) : null}
      {suggestion ? <SuggestionPopup popup={suggestion} /> : null}
    </>
  );
}
