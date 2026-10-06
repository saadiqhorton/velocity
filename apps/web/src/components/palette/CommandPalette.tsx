import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Avatar, Icon, OptionList, Portal, StatusIcon, groupOptions, useOptionListNavigation } from '@velocity/ui';
import type { PopupOption } from '@velocity/ui';
import { GlobalSearchDocument } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { engine, useEngineVersion } from '@/keyboard/react';
import type { Command } from '@/keyboard/engine';
import { fuzzyFilter } from '@/lib/fuzzy';
import { useOpenIssue } from '@/lib/navigation';
import { useRecent } from '@/stores/recent';
import { useUi } from '@/stores/ui';
import type { PaletteMode } from '@/stores/ui';
import { ShortcutHint } from '@/components/common/ShortcutHint';
import { ProjectIcon, TeamIcon } from '@/components/common/EntityIcons';
import { m } from '@/i18n';

function splitMode(input: string, initial: PaletteMode): { mode: PaletteMode; query: string } {
  const first = input[0];
  if (first === '>' || first === '#' || first === '@') return { mode: first, query: input.slice(1).trimStart() };
  return { mode: initial === '' ? '' : initial, query: input };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface Entry {
  option: PopupOption;
  run: () => void;
}

/**
 * Command palette (SPEC §4.13): ⌘/Ctrl+K. Groups: Actions (context-aware), Navigation,
 * Issues (fuzzy on "ENG-123 Title"), Recent. Prefixes: `>` commands, `#` issues, `@` members.
 */
export function CommandPalette() {
  useEngineVersion();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const openIssue = useOpenIssue();
  const initialMode = useUi((s) => s.paletteMode);
  const close = useUi((s) => s.closePalette);
  const recent = useRecent((s) => s.issues);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [input, setInput] = useState<string>(initialMode);
  const { mode, query } = splitMode(input, '');
  const debounced = useDebounced(query.trim(), 150);
  const wantsIssues = (mode === '' || mode === '#') && debounced.length > 0;
  const search = useQuery(GlobalSearchDocument, {
    variables: { query: debounced, limit: 8, types: ['issue'] },
    skip: !wantsIssues,
    fetchPolicy: 'cache-first',
  });

  useEffect(() => {
    inputRef.current?.focus();
    const previous = returnFocus.current;
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  const finish = (run: () => void) => {
    returnFocus.current = null;
    close();
    // Let the palette unmount before the command opens its own UI.
    requestAnimationFrame(run);
  };

  const entries = useMemo(() => {
    const out: Entry[] = [];
    const commands = engine.available();
    const cmdEntry = (c: Command, group: string): Entry => ({
      option: {
        value: `cmd:${c.id}`,
        label: c.title,
        group,
        keywords: c.keywords,
        icon: <Icon name={c.group === 'navigation' ? 'arrow-right' : 'active'} className="text-fg-subtlest" />,
      },
      run: () => c.run(),
    });

    if (mode === '' || mode === '>') {
      const actions = commands.filter((c) => c.group !== 'navigation' && c.group !== 'list');
      const nav = commands.filter((c) => c.group === 'navigation');
      const actionMatches = fuzzyFilter(actions, query, (c) => `${c.title} ${(c.keywords ?? []).join(' ')}`, mode === '>' ? 50 : 8);
      for (const c of actionMatches) out.push(cmdEntry(c, m.palette.actions));
      const navMatches = fuzzyFilter(nav, query, (c) => `${c.title} ${(c.keywords ?? []).join(' ')}`, mode === '>' ? 50 : 8);
      for (const c of navMatches) out.push(cmdEntry(c, m.palette.navigation));
    }

    if (mode === '') {
      const projects = fuzzyFilter(ws.projects, query, (p) => p.name, query ? 5 : 0);
      for (const p of projects) {
        out.push({
          option: { value: `project:${p.id}`, label: p.name, group: m.palette.projects, icon: <ProjectIcon project={p} /> },
          run: () => navigate(`/project/${p.id}`),
        });
      }
      const views = fuzzyFilter(ws.views, query, (v) => v.name, query ? 5 : 0);
      for (const v of views) {
        out.push({
          option: { value: `view:${v.id}`, label: v.name, group: m.palette.views, icon: <Icon name="view" className="text-fg-subtle" /> },
          run: () => navigate(`/view/${v.slug}`),
        });
      }
      const teams = fuzzyFilter(ws.teams, query, (t) => `${t.key} ${t.name}`, query ? 5 : 0);
      for (const t of teams) {
        out.push({
          option: { value: `team:${t.id}`, label: t.name, description: t.key, group: m.palette.teams, icon: <TeamIcon team={t} /> },
          run: () => navigate(`/team/${t.key}/active`),
        });
      }
    }

    if (mode === '' || mode === '#') {
      if (query.trim()) {
        for (const r of search.data?.search ?? []) {
          if (!r.issue) continue;
          const issue = r.issue;
          out.push({
            option: {
              value: `issue:${issue.id}`,
              label: `${issue.identifier} ${issue.title}`,
              group: m.palette.issues,
              icon: <StatusIcon category={issue.status.category} color={issue.status.color} label="" />,
            },
            run: () => openIssue(issue.id, { identifier: issue.identifier, peek: false }),
          });
        }
      } else {
        for (const r of recent) {
          out.push({
            option: { value: `recent:${r.id}`, label: `${r.identifier} ${r.title}`, group: m.palette.recent, icon: <Icon name="list" className="text-fg-subtlest" /> },
            run: () => openIssue(r.id, { identifier: r.identifier, peek: false }),
          });
        }
      }
    }

    if (mode === '@') {
      for (const u of fuzzyFilter(ws.activeUsers, query, (u) => `${u.name} ${u.username}`, 20)) {
        out.push({
          option: {
            value: `user:${u.id}`,
            label: u.name,
            description: `@${u.username}`,
            group: m.palette.members,
            icon: <Avatar name={u.name} src={u.avatarUrl} size={20} />,
          },
          run: () => navigate(`/issues?filter=${encodeURIComponent(`assignee:${u.username}`)}`),
        });
      }
    }
    return out;
  }, [mode, query, ws, search.data, recent, navigate, openIssue]);

  const options = entries.map((e) => e.option);
  const byValue = new Map(entries.map((e) => [e.option.value, e]));
  const select = (value: string) => {
    const e = byValue.get(value);
    if (e) finish(e.run);
  };
  const nav = useOptionListNavigation({ listId, options, onSelect: select });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Tab') {
      // Tab jumps between groups (SPEC §4.13).
      e.preventDefault();
      const groups = groupOptions(options);
      const idx = groups.findIndex((g) => g.options.some((o) => o.value === nav.activeValue));
      const next = groups[(idx + (e.shiftKey ? groups.length - 1 : 1)) % Math.max(groups.length, 1)];
      const first = next?.options[0];
      if (first) nav.setActiveValue(first.value);
      return;
    }
    nav.handleKeyDown(e);
  };

  const placeholder = mode === '>' ? m.palette.placeholderCommands : mode === '#' ? m.palette.placeholderIssues : mode === '@' ? m.palette.placeholderMembers : m.palette.placeholder;
  const shortcutFor = (value: string): string | undefined => {
    if (!value.startsWith('cmd:')) return undefined;
    return engine.get(value.slice(4))?.keys?.[0];
  };

  return (
    <Portal>
      <div className="fixed inset-0 flex justify-center px-4 pt-[12vh]" style={{ zIndex: 'var(--ds-z-index-modal)' }}>
        <div className="fixed inset-0 bg-blanket" aria-hidden="true" onMouseDown={close} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={m.palette.label}
          data-testid="command-palette"
          className="relative flex max-h-[70vh] w-full max-w-160 flex-col self-start overflow-hidden rounded-lg border border-border bg-raised text-fg shadow-overlay"
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 focus-within:border-primary">
            <Icon name="search" className="text-fg-subtlest" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={nav.activeDescendant}
              aria-autocomplete="list"
              aria-label={m.palette.label}
              placeholder={placeholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              autoComplete="off"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-md text-fg placeholder:text-fg-subtlest focus-visible:outline-none"
            />
          </div>
          <OptionList
            id={listId}
            aria-label={m.palette.label}
            options={options}
            selectedValues={[]}
            activeValue={nav.activeValue}
            onActiveChange={nav.setActiveValue}
            onSelect={(o) => select(o.value)}
            emptyMessage={search.loading ? m.common.loading : m.palette.noResults}
            className="max-h-none min-h-0 flex-1 py-2"
            renderOption={(o) => {
              const keys = shortcutFor(o.value);
              return (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex w-5 shrink-0 justify-center">{o.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.description ? <span className="shrink-0 text-sm text-fg-subtlest">{o.description}</span> : null}
                  {keys ? <ShortcutHint binding={keys} /> : null}
                </span>
              );
            }}
          />
          <div className="flex h-9 shrink-0 items-center gap-3 border-t border-border px-4 text-sm text-fg-subtlest">{m.palette.hint}</div>
        </div>
      </div>
    </Portal>
  );
}
