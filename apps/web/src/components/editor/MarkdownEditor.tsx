import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Placeholder } from '@tiptap/extension-placeholder';
import clsx from 'clsx';

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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
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
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && callbacks.current.onSubmit) {
          event.preventDefault();
          callbacks.current.onSubmit(editorRef.current?.getMarkdown() ?? '');
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
    onUpdate: ({ editor: e }) => callbacks.current.onChange?.(e.getMarkdown()),
    onBlur: ({ editor: e }) => callbacks.current.onBlur?.(e.getMarkdown()),
  });
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // External value changes (another member's edit) replace content when not focused.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    if (editor.getMarkdown() !== value) editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);

  useImperativeHandle(
    handle,
    () => ({
      focus: () => editor?.commands.focus('end'),
      clear: () => editor?.commands.clearContent(true),
      getMarkdown: () => editor?.getMarkdown() ?? '',
    }),
    [editor],
  );

  return <EditorContent editor={editor} className={clsx('text-base text-fg', className)} data-own-keys="" />;
}
