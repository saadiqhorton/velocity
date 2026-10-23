import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import type { SearchIssue, SuggestionSources } from './suggestions';
import { applyIssueReference, applyMention } from './suggestions';
import { createEditorExtensions, editorMarkdown } from './markdownExtensions';

const ISSUE = {
  id: '0f3c2a1e-0000-4000-8000-000000000001',
  identifier: 'ENG-123',
  title: 'Fix login redirect',
} as unknown as SearchIssue;

const sources: SuggestionSources = {
  getMembers: () => [],
  searchIssues: () => Promise.resolve([]),
  publish: () => undefined,
};

const editors: Editor[] = [];

function parse(markdown: string): Editor {
  const editor = new Editor({
    extensions: createEditorExtensions({ placeholder: '', sources }),
    content: markdown,
    contentType: 'markdown',
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

describe('markdown round trip of suggestion inserts', () => {
  it('serializes an inserted mention and reference, and parses back to the same document', () => {
    const editor = parse('Thanks for the fix, see');
    applyMention(editor, { from: 8, to: 8 }, 'alice'); // after "Thanks "
    const end = editor.state.doc.content.size - 1; // end of the paragraph
    editor.commands.insertContentAt(end, ' ');
    applyIssueReference(editor, { from: end + 1, to: end + 1 }, ISSUE);

    const markdown = editorMarkdown(editor);
    expect(markdown.trim()).toBe(`Thanks @alice for the fix, see [ENG-123](/issue/${ISSUE.id})`);

    const reparsed = parse(markdown);
    expect(editorMarkdown(reparsed)).toBe(markdown);
    expect(reparsed.getText()).toBe(editor.getText());
    expect(reparsed.getJSON()).toEqual(editor.getJSON());
  });

  it('keeps usernames with punctuation unescaped, so the server reads them as mentions', () => {
    const editor = parse('Ping and');
    applyMention(editor, { from: 6, to: 6 }, 'john_doe.smith'); // after "Ping "
    expect(editor.getText().trim()).toBe('Ping @john_doe.smith and');
    const markdown = editorMarkdown(editor);
    expect(markdown).toContain('@john_doe.smith');
    expect(parse(markdown).getText()).toBe(editor.getText());
  });
});
