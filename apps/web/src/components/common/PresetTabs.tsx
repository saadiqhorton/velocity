import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import clsx from 'clsx';

export interface PresetTab<T extends string> {
  id: T;
  label: string;
  /** Optional trailing count. */
  count?: number | null;
}

export interface PresetTabsProps<T extends string> {
  tabs: readonly PresetTab<T>[];
  value: T;
  onChange: (id: T) => void;
  'aria-label': string;
  className?: string;
}

/** Compact header tabs (role=tablist): arrow keys move and activate, selected tab is the only tab stop. */
export function PresetTabs<T extends string>({ tabs, value, onChange, className, ...rest }: PresetTabsProps<T>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex((t) => t.id === value);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    refs.current[target.id]?.focus();
  };
  return (
    <div role="tablist" aria-label={rest['aria-label']} onKeyDown={onKeyDown} className={clsx('flex shrink-0 items-center gap-1', className)}>
      {tabs.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            data-testid={`tab-${t.id}`}
            className={clsx(
              'inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-sm transition-colors duration-100',
              selected ? 'bg-raised font-medium text-fg' : 'text-fg-subtle hover:bg-hover hover:text-fg',
            )}
          >
            {t.label}
            {t.count ? <span className="text-xs text-fg-subtlest">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
