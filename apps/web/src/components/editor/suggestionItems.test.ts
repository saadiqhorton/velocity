import { describe, expect, it } from 'vitest';
import { m } from '@/i18n';
import {
  SLASH_COMMANDS,
  filterSlashCommands,
  issueHref,
  normalizeLinkHref,
  rankItems,
  rankMembers,
  unescapeMentionMarkdown,
} from './suggestionItems';

const title = (id: (typeof SLASH_COMMANDS)[number]['id']) => m.editor.slash[id];
const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

describe('slash commands', () => {
  it('offers the nine block commands in menu order', () => {
    expect(ids(SLASH_COMMANDS)).toEqual([
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
    expect(SLASH_COMMANDS.map((c) => title(c.id))).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bulleted list',
      'Numbered list',
      'Checklist',
      'Quote',
      'Code block',
      'Divider',
    ]);
  });

  it('lists everything, in order, for an empty query', () => {
    expect(ids(filterSlashCommands('', title))).toEqual(ids(SLASH_COMMANDS));
  });

  it('ranks exact and prefix matches first', () => {
    expect(ids(filterSlashCommands('h2', title))[0]).toBe('heading2');
    expect(ids(filterSlashCommands('code', title))[0]).toBe('codeBlock');
    expect(ids(filterSlashCommands('check', title))[0]).toBe('taskList');
  });

  it('matches several commands for a shared word, keeping menu order between equal scores', () => {
    expect(ids(filterSlashCommands('list', title)).slice(0, 2)).toEqual(['bulletList', 'orderedList']);
  });

  it('returns nothing when no command matches', () => {
    expect(filterSlashCommands('zzz', title)).toEqual([]);
  });

  it('matches the localized title as well as the keywords', () => {
    expect(ids(filterSlashCommands('divider', title))).toEqual(['divider']);
    expect(ids(filterSlashCommands('quote', title))[0]).toBe('blockquote');
  });
});

describe('member ranking', () => {
  const members = [
    { username: 'alice', name: 'Alice Ng' },
    { username: 'bob', name: 'Robert Malik' },
    { username: 'carol', name: 'Carol Alvarez' },
  ];

  it('puts username prefixes before display-name word starts, and substrings last', () => {
    // alice: username prefix; carol: name word start ("Alvarez"); bob: substring only ("Malik").
    expect(rankMembers(members, 'al').map((u) => u.username)).toEqual(['alice', 'carol', 'bob']);
  });

  it('matches display names too', () => {
    expect(rankMembers(members, 'rob').map((u) => u.username)).toEqual(['bob']);
  });

  it('keeps the list order for an empty query and honors the limit', () => {
    expect(rankMembers(members, '').map((u) => u.username)).toEqual(['alice', 'bob', 'carol']);
    expect(rankMembers(members, '', 2)).toHaveLength(2);
  });

  it('ignores case and surrounding spaces', () => {
    expect(rankMembers(members, '  ALICE ').map((u) => u.username)).toEqual(['alice']);
  });

  it('ranks generic items by any of their fields', () => {
    expect(rankItems(['Beta', 'alpha', 'gamma'], 'a', (s) => [s])).toEqual(['alpha', 'Beta', 'gamma']);
  });
});

describe('normalizeLinkHref', () => {
  it('adds https to bare hosts and keeps explicit web and mail links', () => {
    expect(normalizeLinkHref('example.com/docs')).toBe('https://example.com/docs');
    expect(normalizeLinkHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(normalizeLinkHref('mailto:team@example.com')).toBe('mailto:team@example.com');
    expect(normalizeLinkHref('//example.com')).toBe('https://example.com');
  });

  it('keeps in-app paths as they are', () => {
    expect(normalizeLinkHref('/settings')).toBe('/settings');
  });

  it('rejects other schemes and empty input', () => {
    expect(normalizeLinkHref('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkHref('data:text/html,hi')).toBeNull();
    expect(normalizeLinkHref('   ')).toBeNull();
  });
});

describe('issueHref', () => {
  it('points at the issue route, which is keyed by the issue UUID', () => {
    expect(issueHref('0f3c2a1e-0000-4000-8000-000000000001')).toBe('/issue/0f3c2a1e-0000-4000-8000-000000000001');
  });
});

describe('unescapeMentionMarkdown', () => {
  it('writes escaped underscores in @mentions back raw', () => {
    expect(unescapeMentionMarkdown('Ping @john\\_doe.smith now')).toBe('Ping @john_doe.smith now');
    expect(unescapeMentionMarkdown('@a\\_b\\_c')).toBe('@a_b_c');
  });

  it('leaves other escapes and text outside mentions alone', () => {
    expect(unescapeMentionMarkdown('\\_italic\\_ and a\\_b')).toBe('\\_italic\\_ and a\\_b');
    expect(unescapeMentionMarkdown('mail a@b\\_c.com')).toBe('mail a@b\\_c.com');
    expect(unescapeMentionMarkdown('@bob\\*')).toBe('@bob\\*');
  });
});
