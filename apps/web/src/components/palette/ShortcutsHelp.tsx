import { useMemo, useState } from 'react';
import { Modal } from '@velocity/ui';
import { engine, useEngineVersion } from '@/keyboard/react';
import type { CommandGroup } from '@/keyboard/engine';
import { fuzzyScore } from '@/lib/fuzzy';
import { useUi } from '@/stores/ui';
import { ShortcutHint } from '@/components/common/ShortcutHint';
import { m } from '@/i18n';

const GROUP_ORDER: CommandGroup[] = ['general', 'navigation', 'list', 'selection', 'issue'];

/** `?` — searchable list of every registered shortcut (SPEC §4.12). */
export function ShortcutsHelp() {
  useEngineVersion();
  const close = useUi((s) => s.setShortcutsOpen);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const commands = engine
      .all()
      .filter((c) => c.keys && c.keys.length > 0)
      .filter((c) => {
        const key = `${c.title}|${c.keys?.join()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .filter((c) => !query.trim() || fuzzyScore(query, `${c.title} ${c.keys?.join(' ')}`) !== null);
    return GROUP_ORDER.map((g) => ({ group: g, commands: commands.filter((c) => c.group === g) })).filter((g) => g.commands.length > 0);
  }, [query]);

  return (
    <Modal open onClose={() => close(false)} title={m.shortcuts.title} size="lg">
      <div className="flex flex-col gap-4 pb-4" data-testid="shortcuts-help">
        <input
          data-autofocus
          type="search"
          aria-label={m.shortcuts.search}
          placeholder={m.shortcuts.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 w-full rounded-sm border border-border-input bg-input px-2 text-base text-fg placeholder:text-fg-subtlest focus:border-primary"
        />
        <div className="grid max-h-[60vh] grid-cols-1 gap-x-8 gap-y-4 overflow-y-auto md:grid-cols-2">
          {groups.length === 0 ? <p className="text-base text-fg-subtle">{m.shortcuts.noMatch}</p> : null}
          {groups.map((g) => (
            <section key={g.group} aria-label={m.shortcuts.groups[g.group]}>
              <h3 className="mb-1 text-sm font-semibold text-fg-subtle">{m.shortcuts.groups[g.group]}</h3>
              <dl className="flex flex-col">
                {g.commands.map((c) => (
                  <div key={c.id} className="flex h-8 items-center justify-between gap-3 border-b border-border text-base">
                    <dt className="truncate text-fg">{c.title}</dt>
                    <dd className="flex shrink-0 items-center gap-2">
                      {c.keys?.map((k) => (
                        <ShortcutHint key={k} binding={k} />
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}
