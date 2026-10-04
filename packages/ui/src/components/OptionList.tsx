import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from './Icon';

export interface PopupOption {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  /** Section heading; options sharing a group are rendered together. */
  group?: string;
  disabled?: boolean;
  /** Extra strings matched by the search filter. */
  keywords?: string[];
}

export const CREATE_VALUE = '__create__';

export function filterOptions(options: PopupOption[], query: string): PopupOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => [o.label, o.description ?? '', ...(o.keywords ?? [])].some((s) => s.toLowerCase().includes(q)));
}

export interface OptionGroup {
  group?: string;
  options: PopupOption[];
}

/** Groups options by `group` (first-appearance order); ungrouped options stay in the first, headingless section. */
export function groupOptions(options: PopupOption[]): OptionGroup[] {
  const result: OptionGroup[] = [];
  const index = new Map<string, OptionGroup>();
  for (const o of options) {
    const key = o.group ?? '';
    let g = index.get(key);
    if (!g) {
      g = { group: o.group, options: [] };
      index.set(key, g);
      result.push(g);
    }
    g.options.push(o);
  }
  return result;
}

export function optionDomId(listId: string, value: string): string {
  return `${listId}-opt-${value.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export interface OptionListNavigation {
  activeValue: string | null;
  setActiveValue: (value: string | null) => void;
  activeDescendant: string | undefined;
  /** Returns true when the key was handled. */
  handleKeyDown: (e: KeyboardEvent<HTMLElement>) => boolean;
}

/** Keyboard navigation state for a listbox: ↑/↓/Home/End move, Enter selects. */
export function useOptionListNavigation(opts: {
  listId: string;
  options: PopupOption[];
  hasCreate?: boolean;
  initialActiveValue?: string | null;
  onSelect: (value: string) => void;
}): OptionListNavigation {
  const { listId, options, hasCreate = false, initialActiveValue = null, onSelect } = opts;
  const [active, setActive] = useState<string | null>(initialActiveValue);
  const navigable: string[] = [
    ...groupOptions(options)
      .flatMap((g) => g.options)
      .filter((o) => !o.disabled)
      .map((o) => o.value),
    ...(hasCreate ? [CREATE_VALUE] : []),
  ];
  const activeValue = active !== null && navigable.includes(active) ? active : (navigable[0] ?? null);

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>): boolean => {
    if (navigable.length === 0) return false;
    const idx = activeValue === null ? -1 : navigable.indexOf(activeValue);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive(navigable[Math.min(idx + 1, navigable.length - 1)] ?? null);
        return true;
      case 'ArrowUp':
        e.preventDefault();
        setActive(navigable[Math.max(idx - 1, 0)] ?? null);
        return true;
      case 'Home':
        e.preventDefault();
        setActive(navigable[0] ?? null);
        return true;
      case 'End':
        e.preventDefault();
        setActive(navigable[navigable.length - 1] ?? null);
        return true;
      case 'Enter':
        if (activeValue === null) return false;
        e.preventDefault();
        onSelect(activeValue);
        return true;
      default:
        return false;
    }
  };

  return {
    activeValue,
    setActiveValue: setActive,
    activeDescendant: activeValue ? optionDomId(listId, activeValue) : undefined,
    handleKeyDown,
  };
}

export interface OptionRenderState {
  selected: boolean;
  active: boolean;
}

export interface OptionListProps {
  id: string;
  options: PopupOption[];
  selectedValues: string[];
  activeValue: string | null;
  onActiveChange: (value: string) => void;
  onSelect: (option: PopupOption) => void;
  multiple?: boolean;
  renderOption?: (option: PopupOption, state: OptionRenderState) => ReactNode;
  emptyMessage?: string;
  /** Adds a trailing "create" row. */
  create?: { label: string; onSelect: () => void } | null;
  'aria-label': string;
  /** Make the listbox itself focusable (when there is no search input). */
  focusable?: boolean;
  activeDescendant?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  className?: string;
}

/** Listbox with grouped sections, check marks and a primary-subtle active row. */
export function OptionList({
  id,
  options,
  selectedValues,
  activeValue,
  onActiveChange,
  onSelect,
  multiple,
  renderOption,
  emptyMessage = 'No results',
  create,
  focusable,
  activeDescendant,
  onKeyDown,
  className,
  ...rest
}: OptionListProps) {
  const groups = groupOptions(options);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeValue) return;
    const el = document.getElementById(optionDomId(id, activeValue));
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [activeValue, id]);

  const rowClass = (active: boolean, disabled?: boolean) =>
    clsx(
      'flex min-h-8 cursor-pointer items-center gap-2 px-3 py-1 text-base',
      active ? 'bg-primary-subtle' : '',
      disabled ? 'cursor-not-allowed text-fg-disabled' : 'text-fg',
    );

  const renderRow = (o: PopupOption) => {
    const selected = selectedValues.includes(o.value);
    const active = activeValue === o.value;
    return (
      <div
        key={o.value}
        id={optionDomId(id, o.value)}
        role="option"
        aria-selected={selected}
        aria-disabled={o.disabled || undefined}
        onMouseMove={() => {
          if (!o.disabled && !active) onActiveChange(o.value);
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!o.disabled) onSelect(o);
        }}
        className={rowClass(active, o.disabled)}
      >
        {renderOption ? (
          <div className="min-w-0 flex-1">{renderOption(o, { selected, active })}</div>
        ) : (
          <>
            {o.icon ? <span className="inline-flex shrink-0 items-center">{o.icon}</span> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{o.label}</span>
              {o.description ? <span className="block truncate text-sm text-fg-subtle">{o.description}</span> : null}
            </span>
          </>
        )}
        <span className="inline-flex w-4 shrink-0 justify-center text-fg-selected">
          {selected ? <Icon name="check" /> : null}
        </span>
      </div>
    );
  };

  return (
    <div
      ref={listRef}
      id={id}
      role="listbox"
      aria-label={rest['aria-label']}
      aria-multiselectable={multiple || undefined}
      aria-activedescendant={focusable ? activeDescendant : undefined}
      tabIndex={focusable ? 0 : undefined}
      onKeyDown={onKeyDown}
      className={clsx('max-h-60 overflow-y-auto py-1', className)}
    >
      {groups.map((g, gi) =>
        g.group ? (
          <div key={g.group} role="group" aria-labelledby={`${id}-group-${gi}`}>
            <div id={`${id}-group-${gi}`} className="px-3 pb-1 pt-2 text-xs font-semibold uppercase text-fg-subtle">
              {g.group}
            </div>
            {g.options.map(renderRow)}
          </div>
        ) : (
          <div key={`__ungrouped-${gi}`} role="group">
            {g.options.map(renderRow)}
          </div>
        ),
      )}
      {create ? (
        <div
          id={optionDomId(id, CREATE_VALUE)}
          role="option"
          aria-selected={false}
          onMouseMove={() => onActiveChange(CREATE_VALUE)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={create.onSelect}
          className={clsx(rowClass(activeValue === CREATE_VALUE), 'border-t border-border')}
        >
          <Icon name="add" />
          <span className="min-w-0 flex-1 truncate">{create.label}</span>
        </div>
      ) : null}
      {options.length === 0 && !create ? <div className="px-3 py-2 text-base text-fg-subtle">{emptyMessage}</div> : null}
    </div>
  );
}
