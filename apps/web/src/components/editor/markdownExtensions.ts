import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Placeholder } from '@tiptap/extension-placeholder';
import type { Editor } from '@tiptap/core';
import { createSuggestionExtension } from './suggestions';
import type { SuggestionSources } from './suggestions';
import { unescapeMentionMarkdown } from './suggestionItems';

/** The markdown the editor stores and sends: TipTap's serializer with `@mentions` kept raw. */
export function editorMarkdown(editor: Editor): string {
  return unescapeMentionMarkdown(editor.getMarkdown());
}

/** The extension set for every markdown editor (issue description, comments). Shared with tests. */
export function createEditorExtensions({ placeholder, sources }: { placeholder: string; sources: SuggestionSources }) {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
    Markdown,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder }),
    createSuggestionExtension(sources),
  ];
}
