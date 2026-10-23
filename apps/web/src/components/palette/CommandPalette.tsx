import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApolloClient, useQuery } from '@apollo/client';
import clsx from 'clsx';
import { Avatar, Icon, OptionList, Portal, StatusIcon, groupOptions, useOptionListNavigation } from '@velocity/ui';
import type { PopupOption, PresenceState } from '@velocity/ui';
import { GlobalSearchDocument } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { engine, useEngineVersion } from '@/keyboard/react';
import type { Command, CommandPageKey } from '@/keyboard/engine';
import { fuzzySearch, matchRuns } from '@/lib/fuzzy';
import type { FuzzyResult } from '@/lib/fuzzy';
import { readIssueRow } from '@/lib/issueCache';
import { useOpenIssue } from '@/lib/navigation';
import { targetIssueIds } from '@/lib/targets';
import { useRecent } from '@/stores/recent';
import { useUi } from '@/stores/ui';
import type { PaletteMode } from '@/stores/ui';
import { ShortcutHint } from '@/components/common/ShortcutHint';
import { ProjectIcon, TeamIcon } from '@/components/common/EntityIcons';
import { usePaletteModel } from '@/components/palette/pages';
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
  /** Matched characters of the label, highlighted in the row. */
  indices?: number[];
  run: () => void;
  /** Runs without closing the palette (opening a sub-page, toggling a label). */
  stay?: boolean;
  /** Closes the palette but keeps focus on the row the property change came from. */
  keepFocus?: boolean;
}

/** Matched characters in `text-fg`, the rest in `text-fg-subtle` (SPEC §4.13). */
function Highlighted({ text, indices }: { text: string; indices?: number[] }) {
  if (!indices?.length) return <>{text}</>;
  return (
    <>
      {matchRuns(text, indices).map((run, i) => (
        <span key={i} className={run.matched ? 'text-fg' : 'text-fg-subtle'}>
          {run.text}
        </span>
      ))}
    </>
  );
}

/**
 * Command palette (SPEC §4.13): ⌘/Ctrl+K. Groups: Issue actions and Actions (context-aware),
 * Navigation, Issues (fuzzy on "ENG-123 Title"), Recent. Prefixes: `>` commands, `#` issues,
 * `@` members. Property commands open a sub-page of options instead of running.
 */
export function CommandPalette({ state = 'open' }: { state?: PresenceState }) {
  useEngineVersion();
  const ws = useWorkspace();
  const client = useApolloClient();
  const navigate = useNavigate();
  const openIssue = useOpenIssue();
  const initialMode = useUi((s) => s.paletteMode);
  const close = useUi((s) => s.closePalette);
  const recent = useRecent((s) => s.issues);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  // The issues the palette acts on, fixed when it opens (the chip shows them).
  const [targetIds] = useState(() => targetIssueIds());
  const [input, setInput] = useState<string>(initialMode);
  const [pageKey, setPageKey] = useState<CommandPageKey | null>(null);
  // Labels toggled on the open sub-page; null until the first toggle.
  const [picked, setPicked] = useState<string[] | null>(null);
  const model = usePaletteModel(pageKey, targetIds);
  const onPage = model !== null;
  const split = splitMode(input, '');
  const mode: PaletteMode = onPage ? '' : split.mode;
  const query = onPage ? input : split.query;
  const debounced = useDebounced(query.trim(), 150);
  const wantsIssues = !onPage && (mode === '' || mode === '#') && debounced.length > 0;
  const search = useQuery(GlobalSearchDocument, {
    variables: { query: debounced, limit: 8, types: ['issue'] },
    skip: !wantsIssues,
    fetchPolicy: 'cache-first',
  });

  // Focus goes back to the opener as soon as the palette starts closing; the exit plays without focus.
  // A palette that unmounts without an exit (reduced motion) returns it on unmount instead.
  const focusReturned = useRef(false);
  const exiting = state === 'exit';
  // An exiting palette is not modal: the keyboard engine skips modal-blocked shortcuts, so Ctrl+K must still reopen it.
  useEffect(() => {
    if (!exiting) return;
    focusReturned.current = true;
    const previous = returnFocus.current;
    returnFocus.current = null;
    if (previous && document.contains(previous)) previous.focus();
    // With nothing to return to (a command ran, or the opener was the page body) the input would keep focus
    // through the exit, and a Ctrl+K typed in that window would be swallowed by the input instead of reopening.
    if (inputRef.current && document.activeElement === inputRef.current) inputRef.current.blur();
  }, [exiting]);
  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      const previous = returnFocus.current;
      if (!focusReturned.current && previous && document.contains(previous)) previous.focus();
    };
  }, []);

  const finish = (run: () => void, keepFocus = false) => {
    if (!keepFocus) returnFocus.current = null;
    close();
    // Let the palette unmount before the command opens its own UI.
    requestAnimationFrame(run);
  };

  const entries = useMemo(() => {
    const out: Entry[] = [];

    if (model) {
      // Property sub-page: its options, with the current values checked.
      const current = picked ?? model.selected;
      const matches = fuzzySearch(
        model.options,
        query,
        (o) => `${o.label} ${o.description ?? ''} ${(o.keywords ?? []).join(' ')}`,
        Number.POSITIVE_INFINITY,
      );
      for (const { item: o, indices } of matches) {
        if (model.multiple) {
          const wasSelected = current.includes(o.value);
          out.push({
            option: o,
            indices,
            stay: true,
            run: () => {
              setPicked(wasSelected ? current.filter((v) => v !== o.value) : [...current, o.value]);
              model.apply(o.value, wasSelected);
            },
          });
        } else {
          out.push({ option: o, indices, keepFocus: true, run: () => model.apply(o.value, false) });
        }
      }
      return out;
    }

    const commands = engine.available();
    const cmdEntry = (r: FuzzyResult<Command>, group: string): Entry => {
      const c = r.item;
      const option: PopupOption = {
        value: `cmd:${c.id}`,
        label: c.title,
        group,
        keywords: c.keywords,
        icon: <Icon name={c.icon ?? (c.group === 'navigation' ? 'arrow-right' : 'active')} className="text-fg-subtlest" />,
      };
      const page = c.page;
      if (page) {
        return {
          option,
          indices: r.indices,
          stay: true,
          run: () => {
            setPageKey(page);
            setPicked(null);
            setInput('');
          },
        };
      }
      return { option, indices: r.indices, run: () => c.run() };
    };

    if (mode === '' || mode === '>') {
      const actions = commands.filter((c) => c.group !== 'navigation' && c.group !== 'list');
      const nav = commands.filter((c) => c.group === 'navigation');
      const text = (c: Command) => `${c.title} ${(c.keywords ?? []).join(' ')}`;
      const limit = mode === '>' ? 50 : 8;
      // Issue actions come first: they act on the issues in the chip (context first).
      for (const r of fuzzySearch(actions.filter((c) => c.group === 'issue'), query, text, limit)) out.push(cmdEntry(r, m.palette.issueActions));
      for (const r of fuzzySearch(actions.filter((c) => c.group !== 'issue'), query, text, limit)) out.push(cmdEntry(r, m.palette.actions));
      for (const r of fuzzySearch(nav, query, text, limit)) out.push(cmdEntry(r, m.palette.navigation));
    }

    if (mode === '') {
      for (const { item: p, indices } of fuzzySearch(ws.projects, query, (p) => p.name, query ? 5 : 0)) {
        out.push({
          option: { value: `project:${p.id}`, label: p.name, group: m.palette.projects, icon: <ProjectIcon project={p} /> },
          indices,
          run: () => navigate(`/project/${p.id}`),
        });
      }
      for (const { item: v, indices } of fuzzySearch(ws.views, query, (v) => v.name, query ? 5 : 0)) {
        out.push({
          option: { value: `view:${v.id}`, label: v.name, group: m.palette.views, icon: <Icon name="view" className="text-fg-subtle" /> },
          indices,
          run: () => navigate(`/view/${v.slug}`),
        });
      }
      for (const { item: t, indices } of fuzzySearch(ws.teams, query, (t) => `${t.key} ${t.name}`, query ? 5 : 0)) {
        out.push({
          option: { value: `team:${t.id}`, label: t.name, description: t.key, group: m.palette.teams, icon: <TeamIcon team={t} /> },
          indices,
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
      for (const { item: u, indices } of fuzzySearch(ws.activeUsers, query, (u) => `${u.name} ${u.username}`, 20)) {
        out.push({
          option: {
            value: `user:${u.id}`,
            label: u.name,
            description: `@${u.username}`,
            group: m.palette.members,
            icon: <Avatar name={u.name} src={u.avatarUrl} size={20} />,
          },
          indices,
          run: () => navigate(`/issues?filter=${encodeURIComponent(`assignee:${u.username}`)}`),
        });
      }
    }
    return out;
  }, [mode, query, ws, search.data, recent, navigate, openIssue, model, picked]);

  const options = entries.map((e) => e.option);
  const byValue = new Map(entries.map((e) => [e.option.value, e]));
  const select = (value: string) => {
    const e = byValue.get(value);
    if (!e) return;
    if (e.stay) e.run();
    else finish(e.run, e.keepFocus);
  };
  const nav = useOptionListNavigation({ listId, options, onSelect: select });

  const backToRoot = () => {
    setPageKey(null);
    setPicked(null);
    setInput('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // Esc steps back out of a sub-page before it closes the palette.
      if (onPage) backToRoot();
      else close();
      return;
    }
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Backspace' && onPage && input === '') {
      e.preventDefault();
      backToRoot();
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

  const [onlyTarget] = targetIds;
  const targetChip =
    targetIds.length > 1
      ? m.palette.targetCount(targetIds.length)
      : onlyTarget
        ? (readIssueRow(client.cache, onlyTarget)?.identifier ?? m.palette.targetCount(1))
        : null;
  const selectedValues = model ? (picked ?? model.selected) : [];
  const placeholder = model
    ? model.placeholder
    : mode === '>'
      ? m.palette.placeholderCommands
      : mode === '#'
        ? m.palette.placeholderIssues
        : mode === '@'
          ? m.palette.placeholderMembers
          : m.palette.placeholder;
  const shortcutFor = (value: string): string | undefined => {
    if (!value.startsWith('cmd:')) return undefined;
    return engine.get(value.slice(4))?.keys?.[0];
  };

  return (
    <Portal>
      <div
        className={clsx('fixed inset-0 flex justify-center px-4 pt-[12vh]', exiting && 'pointer-events-none')}
        style={{ zIndex: 'var(--ds-z-index-modal)' }}
        aria-hidden={exiting || undefined}
      >
        <div className="fixed inset-0 bg-blanket" aria-hidden="true" onMouseDown={close} />
        <div
          role="dialog"
          aria-modal={exiting ? undefined : true}
          aria-label={m.palette.label}
          data-testid="command-palette"
          className={clsx(
            'relative flex max-h-[70vh] w-full max-w-160 flex-col self-start overflow-hidden rounded-lg border border-border bg-raised text-fg shadow-overlay',
            state === 'enter' && 'ds-pop-in',
            exiting && 'ds-pop-out',
          )}
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 focus-within:border-primary">
            <Icon name="search" className="text-fg-subtlest" />
            {targetChip ? (
              <span
                data-testid="palette-target"
                className="inline-flex h-5 shrink-0 items-center rounded-sm bg-neutral-hover px-1.5 text-sm font-medium text-fg-subtle"
              >
                {targetChip}
              </span>
            ) : null}
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
            selectedValues={selectedValues}
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
                  <span className="min-w-0 flex-1 truncate">
                    <Highlighted text={o.label} indices={byValue.get(o.value)?.indices} />
                  </span>
                  {o.description ? <span className="shrink-0 text-sm text-fg-subtlest">{o.description}</span> : null}
                  {keys ? <ShortcutHint binding={keys} /> : null}
                </span>
              );
            }}
          />
          <div className="flex h-9 shrink-0 items-center gap-3 border-t border-border px-4 text-sm text-fg-subtlest">
            {onPage ? m.palette.pageHint : m.palette.hint}
          </div>
        </div>
      </div>
    </Portal>
  );
}
