import type { ReactNode } from 'react';
import { Extension } from '@tiptap/core';
import type { ChainedCommands, Editor, Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import Suggestion, { exitSuggestion } from '@tiptap/suggestion';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { Avatar, StatusIcon } from '@velocity/ui';
import type { PopupOption } from '@velocity/ui';
import type { GlobalSearchQuery, UserFieldsFragment } from '@/gql/graphql';
import { m } from '@/i18n';
import { filterSlashCommands, issueHref, rankMembers } from './suggestionItems';
import type { SlashCommand, SlashCommandId } from './suggestionItems';

export type SuggestionOwner = 'slash' | 'mention' | 'issue';

/** A workspace member as offered by the `@` menu. */
export type MemberSuggestion = Pick<UserFieldsFragment, 'id' | 'name' | 'username' | 'avatarUrl'>;

/** An issue row from the same `GlobalSearch` query the command palette runs. */
export type SearchIssue = NonNullable<NonNullable<GlobalSearchQuery['search'][number]['issue']>>;

/** What the React layer renders for the open suggestion list (see SuggestionPopup). */
export interface SuggestionPopupModel {
  owner: SuggestionOwner;
  /** Caret rectangle the list opens under; null when the editor cannot measure it. */
  rect: DOMRect | null;
  options: PopupOption[];
  activeValue: string | null;
  emptyMessage: string;
  pick: (value: string) => void;
  hover: (value: string) => void;
}

export interface SuggestionSources {
  getMembers: () => readonly MemberSuggestion[];
  /** Runs the palette's issue search; resolves to [] on failure. */
  searchIssues: (query: string) => Promise<SearchIssue[]>;
  publish: (owner: SuggestionOwner, popup: SuggestionPopupModel | null) => void;
}

/** One plugin key per menu so `isSuggestionOpen` can tell them apart. */
const keys: Record<SuggestionOwner, PluginKey> = {
  slash: new PluginKey('editorSlashMenu'),
  mention: new PluginKey('editorMentionMenu'),
  issue: new PluginKey('editorIssueMenu'),
};

/** True while any suggestion list is open; the editor's own Esc/Enter handling yields to it. */
export function isSuggestionOpen(state: EditorState): boolean {
  return (Object.values(keys) as PluginKey[]).some((key) => (key.getState(state) as { active?: boolean } | undefined)?.active === true);
}

export function closeSuggestions(view: EditorView): void {
  for (const key of Object.values(keys)) {
    if ((key.getState(view.state) as { active?: boolean } | undefined)?.active) exitSuggestion(view, key);
  }
}

/** Text typed after the trigger character, inside the matched range. */
function queryAt(state: EditorState, range: Range): string {
  return state.doc.textBetween(range.from + 1, range.to);
}

const slashTitle = (id: SlashCommandId): string => m.editor.slash[id];

/** Runs a slash command: removes the typed `/query`, then applies the block change at the caret. */
export function applySlashCommand(editor: Editor, range: Range, id: SlashCommandId): void {
  const base = editor.chain().deleteRange(range);
  let chain: ChainedCommands;
  switch (id) {
    case 'heading1':
      chain = base.setHeading({ level: 1 });
      break;
    case 'heading2':
      chain = base.setHeading({ level: 2 });
      break;
    case 'heading3':
      chain = base.setHeading({ level: 3 });
      break;
    case 'bulletList':
      chain = base.toggleBulletList();
      break;
    case 'orderedList':
      chain = base.toggleOrderedList();
      break;
    case 'taskList':
      chain = base.toggleTaskList();
      break;
    case 'blockquote':
      chain = base.setBlockquote();
      break;
    case 'codeBlock':
      chain = base.setCodeBlock();
      break;
    case 'divider':
      chain = base.setHorizontalRule();
      break;
  }
  chain.run();
}

/** `@username` is the syntax the server's mention parser reads (services/lib/markdown.ts extractMentions). */
export function applyMention(editor: Editor, range: Range, username: string): void {
  editor
    .chain()
    .insertContentAt(range, [{ type: 'text', text: `@${username} ` }])
    .run();
}

/** A markdown link to the issue route; the link text is the identifier the server also recognizes. */
export function applyIssueReference(editor: Editor, range: Range, issue: Pick<SearchIssue, 'id' | 'identifier'>): void {
  editor
    .chain()
    .insertContentAt(range, [
      { type: 'text', text: issue.identifier, marks: [{ type: 'link', attrs: { href: issueHref(issue.id) } }] },
      { type: 'text', text: ' ' },
    ])
    .run();
}

/**
 * Renderer shared by the three menus: keeps the highlighted index, maps items to list options and
 * publishes the list to React. Esc is handled by the suggestion plugin (it closes and returns true).
 */
function popupRenderer<T>(owner: SuggestionOwner, toOption: (item: T) => PopupOption, emptyMessage: string, publish: SuggestionSources['publish']) {
  let current: SuggestionProps<T, T> | null = null;
  let active = 0;

  const emit = () => {
    const props = current;
    if (!props) return;
    const items = props.items;
    active = Math.min(active, Math.max(items.length - 1, 0));
    const options = items.map(toOption);
    publish(owner, {
      owner,
      rect: props.clientRect?.() ?? null,
      options,
      activeValue: options[active]?.value ?? null,
      emptyMessage,
      pick: (value) => {
        const index = options.findIndex((o) => o.value === value);
        const item = items[index];
        if (item !== undefined) props.command(item);
      },
      hover: (value) => {
        const index = options.findIndex((o) => o.value === value);
        if (index >= 0) {
          active = index;
          emit();
        }
      },
    });
  };

  return {
    onStart(props: SuggestionProps<T, T>) {
      current = props;
      active = 0;
      emit();
    },
    onUpdate(props: SuggestionProps<T, T>) {
      current = props;
      emit();
    },
    onKeyDown({ event }: SuggestionKeyDownProps): boolean {
      const props = current;
      if (!props) return false;
      // Keep Esc away from the editor's own handler, the global shortcuts and open modals.
      if (event.key === 'Escape') {
        event.stopPropagation();
        return false;
      }
      if (event.isComposing) return false;
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) return true; // never submit or break the line while a list is open
      const items = props.items;
      if (items.length === 0) return false;
      switch (event.key) {
        case 'ArrowDown':
          active = (active + 1) % items.length;
          emit();
          return true;
        case 'ArrowUp':
          active = (active - 1 + items.length) % items.length;
          emit();
          return true;
        case 'Enter': {
          const item = items[active];
          if (item === undefined) return false;
          props.command(item);
          return true;
        }
        default:
          return false;
      }
    },
    onExit() {
      current = null;
      publish(owner, null);
    },
  };
}

function slashSuggestion(editor: Editor, sources: SuggestionSources) {
  return Suggestion<SlashCommand, SlashCommand>({
    editor,
    pluginKey: keys.slash,
    char: '/',
    allowSpaces: true,
    allowedPrefixes: [' '],
    allow: ({ editor: e, state, range }) => !e.isActive('codeBlock') && filterSlashCommands(queryAt(state, range), slashTitle).length > 0,
    items: ({ query }) => filterSlashCommands(query, slashTitle),
    command: ({ editor: e, range, props }) => applySlashCommand(e, range, props.id),
    render: () => popupRenderer<SlashCommand>('slash', (c) => ({ value: c.id, label: slashTitle(c.id) }), m.editor.noMatches, sources.publish),
  });
}

function mentionSuggestion(editor: Editor, sources: SuggestionSources) {
  return Suggestion<MemberSuggestion, MemberSuggestion>({
    editor,
    pluginKey: keys.mention,
    char: '@',
    allowedPrefixes: [' '],
    allow: ({ editor: e, state, range }) => !e.isActive('codeBlock') && rankMembers(sources.getMembers(), queryAt(state, range)).length > 0,
    items: ({ query }) => rankMembers(sources.getMembers(), query),
    command: ({ editor: e, range, props }) => applyMention(e, range, props.username),
    render: () =>
      popupRenderer<MemberSuggestion>(
        'mention',
        (u) => ({
          value: u.id,
          label: u.name,
          description: `@${u.username}`,
          icon: <Avatar name={u.name} src={u.avatarUrl} size={20} />,
        }),
        m.editor.noMatches,
        sources.publish,
      ),
  });
}

function issueSuggestion(editor: Editor, sources: SuggestionSources) {
  return Suggestion<SearchIssue, SearchIssue>({
    editor,
    pluginKey: keys.issue,
    char: '#',
    allowSpaces: true,
    allowedPrefixes: [' '],
    debounce: 150,
    allow: ({ editor: e, state, range }) => !e.isActive('codeBlock') && queryAt(state, range).trim().length > 0,
    items: async ({ query }) => {
      const q = query.trim();
      return q ? sources.searchIssues(q) : [];
    },
    command: ({ editor: e, range, props }) => applyIssueReference(e, range, props),
    render: () =>
      popupRenderer<SearchIssue>(
        'issue',
        (issue) => {
          const icon: ReactNode = <StatusIcon category={issue.status.category} color={issue.status.color} label="" />;
          return { value: issue.id, label: `${issue.identifier} ${issue.title}`, icon };
        },
        m.editor.noIssues,
        sources.publish,
      ),
  });
}

/**
 * Registers the `/`, `@` and `#` menus. Priority is high so these plugins see Enter and Esc before
 * StarterKit's keymap does.
 */
export function createSuggestionExtension(sources: SuggestionSources) {
  return Extension.create({
    name: 'editorSuggestions',
    priority: 1000,
    addProseMirrorPlugins() {
      return [slashSuggestion(this.editor, sources), mentionSuggestion(this.editor, sources), issueSuggestion(this.editor, sources)];
    },
  });
}
