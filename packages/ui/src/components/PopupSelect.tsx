import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import { Popover } from './Popover';
import type { Placement } from './Popover';
import {
  CREATE_VALUE,
  OptionList,
  filterOptions,
  useOptionListNavigation,
} from './OptionList';
import type { OptionRenderState, PopupOption } from './OptionList';
import { useControllableState, useIsomorphicLayoutEffect } from '../utils/react';

export interface PopupSelectTriggerProps {
  ref: Ref<HTMLElement>;
  onClick: (e: MouseEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  'aria-haspopup': 'listbox';
  'aria-expanded': boolean;
  selectedOptions: PopupOption[];
  open: boolean;
}

interface PopupSelectBase {
  options: PopupOption[];
  /** Accessible name for the picker (search input and listbox). */
  label: string;
  placeholder?: string;
  searchPlaceholder?: string;
  searchable?: boolean;
  emptyMessage?: string;
  renderOption?: (option: PopupOption, state: OptionRenderState) => ReactNode;
  /** Creatable hook: shows a "Create" row for non-matching queries. */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Anchor the popup to this element and render no trigger (e.g. keyboard shortcuts). */
  anchorEl?: HTMLElement | null;
  renderTrigger?: (props: PopupSelectTriggerProps) => ReactNode;
  triggerVariant?: 'default' | 'subtle';
  triggerSize?: 'sm' | 'md';
  disabled?: boolean;
  placement?: Placement;
  className?: string;
}

export interface PopupSelectSingleProps extends PopupSelectBase {
  multiple?: false;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string) => void;
}

export interface PopupSelectMultiProps extends PopupSelectBase {
  multiple: true;
  value?: string[];
  defaultValue?: string[];
  onChange?: (values: string[]) => void;
}

export type PopupSelectProps = PopupSelectSingleProps | PopupSelectMultiProps;

function toArray(v: string | string[] | null | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  if (v === null) return [];
  return Array.isArray(v) ? v : [v];
}

export function PopupSelect(props: PopupSelectProps) {
  const {
    options,
    label,
    placeholder = 'Select',
    searchPlaceholder = 'Search',
    searchable = true,
    emptyMessage,
    renderOption,
    onCreate,
    createLabel = (q) => `Create "${q}"`,
    anchorEl,
    renderTrigger,
    triggerVariant = 'default',
    triggerSize = 'md',
    disabled,
    placement = 'bottom-start',
  } = props;
  const multiple = props.multiple === true;
  const listId = useId();
  const [isOpen, setOpen] = useControllableState(props.open, props.defaultOpen ?? false, props.onOpenChange);
  const [selected, setSelected] = useControllableState<string[]>(toArray(props.value), toArray(props.defaultValue) ?? []);
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);
  const anchor = anchorEl !== undefined ? anchorEl : triggerEl;

  const wasOpen = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);

  useIsomorphicLayoutEffect(() => {
    if (isOpen && !wasOpen.current) {
      const a = document.activeElement;
      previousFocus.current = a instanceof HTMLElement && a !== document.body ? a : null;
    }
    if (!isOpen && wasOpen.current && restoreFocus.current) {
      const target = previousFocus.current && document.contains(previousFocus.current) ? previousFocus.current : triggerEl;
      target?.focus();
      restoreFocus.current = false;
    }
    wasOpen.current = isOpen;
  }, [isOpen, triggerEl]);

  const close = (restore: boolean) => {
    restoreFocus.current = restore;
    setOpen(false);
  };

  const commit = (next: string[]) => {
    setSelected(next);
    if (props.multiple === true) props.onChange?.(next);
    else if (next[0] !== undefined) props.onChange?.(next[0]);
  };

  const onSelectOption = (option: PopupOption) => {
    if (multiple) {
      commit(selected.includes(option.value) ? selected.filter((v) => v !== option.value) : [...selected, option.value]);
    } else {
      commit([option.value]);
      close(true);
    }
  };

  const selectedOptions = options.filter((o) => selected.includes(o.value));
  const triggerText =
    selectedOptions.length === 0
      ? placeholder
      : multiple && selectedOptions.length > 1
        ? `${selectedOptions.length} selected`
        : (selectedOptions[0]?.label ?? placeholder);

  const triggerProps: PopupSelectTriggerProps = {
    ref: setTriggerEl,
    onClick: () => setOpen(!isOpen),
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' && !isOpen) {
        e.preventDefault();
        setOpen(true);
      }
    },
    'aria-haspopup': 'listbox',
    'aria-expanded': isOpen,
    selectedOptions,
    open: isOpen,
  };

  let trigger: ReactNode = null;
  if (anchorEl === undefined) {
    trigger = renderTrigger ? (
      renderTrigger(triggerProps)
    ) : (
      <Button
        variant={triggerVariant}
        size={triggerSize}
        disabled={disabled}
        className={props.className}
        ref={setTriggerEl as Ref<HTMLButtonElement>}
        onClick={triggerProps.onClick}
        onKeyDown={triggerProps.onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        iconAfter={<Icon name="chevron-down" />}
      >
        {triggerText}
      </Button>
    );
  }

  return (
    <>
      {trigger}
      <Popover
        anchorEl={anchor}
        open={isOpen && !disabled}
        placement={placement}
        matchWidth
        className="w-60"
        onDismiss={() => close(false)}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <PopupSelectPanel
          listId={listId}
          options={options}
          label={label}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
          emptyMessage={emptyMessage}
          renderOption={renderOption}
          selected={selected}
          multiple={multiple}
          onCreate={onCreate}
          createLabel={createLabel}
          onSelectOption={onSelectOption}
          onClose={close}
        />
      </Popover>
    </>
  );
}

interface PanelProps {
  listId: string;
  options: PopupOption[];
  label: string;
  searchable: boolean;
  searchPlaceholder: string;
  emptyMessage?: string;
  renderOption?: (option: PopupOption, state: OptionRenderState) => ReactNode;
  selected: string[];
  multiple: boolean;
  onCreate?: (query: string) => void;
  createLabel: (query: string) => string;
  onSelectOption: (option: PopupOption) => void;
  onClose: (restoreFocus: boolean) => void;
}

function PopupSelectPanel(p: PanelProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const filtered = filterOptions(p.options, query);
  const trimmed = query.trim();
  const showCreate =
    Boolean(p.onCreate) && trimmed !== '' && !p.options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase());

  const doCreate = () => {
    p.onCreate?.(trimmed);
    if (p.multiple) setQuery('');
    else p.onClose(true);
  };

  const nav = useOptionListNavigation({
    listId: p.listId,
    options: filtered,
    hasCreate: showCreate,
    initialActiveValue: p.options.find((o) => p.selected.includes(o.value))?.value ?? null,
    onSelect: (value) => {
      if (value === CREATE_VALUE) {
        doCreate();
        return;
      }
      const option = filtered.find((o) => o.value === value);
      if (option) p.onSelectOption(option);
    },
  });

  useIsomorphicLayoutEffect(() => {
    (inputRef.current ?? listRef.current)?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      p.onClose(true);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      p.onClose(true);
      return;
    }
    nav.handleKeyDown(e);
  };

  return (
    <div onKeyDown={onKeyDown}>
      {p.searchable ? (
        <div className="border-b border-border p-2">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={p.label}
            aria-expanded={true}
            aria-controls={p.listId}
            aria-autocomplete="list"
            aria-activedescendant={nav.activeDescendant}
            placeholder={p.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            className="h-7 w-full rounded-sm border border-border-input bg-input px-2 text-base text-fg placeholder:text-fg-subtlest focus:border-primary"
          />
        </div>
      ) : null}
      <OptionList
        id={p.listId}
        aria-label={p.label}
        options={filtered}
        selectedValues={p.selected}
        activeValue={nav.activeValue}
        onActiveChange={nav.setActiveValue}
        onSelect={p.onSelectOption}
        multiple={p.multiple}
        renderOption={p.renderOption}
        emptyMessage={p.emptyMessage}
        create={showCreate ? { label: p.createLabel(trimmed), onSelect: doCreate } : null}
        focusable={!p.searchable}
        activeDescendant={nav.activeDescendant}
      />
      {!p.searchable ? <ListFocusBridge listRef={listRef} listId={p.listId} /> : null}
    </div>
  );
}

/** Finds the (focusable) listbox element so the panel can focus it when there is no search input. */
function ListFocusBridge({ listRef, listId }: { listRef: { current: HTMLDivElement | null }; listId: string }) {
  useIsomorphicLayoutEffect(() => {
    const el = document.getElementById(listId);
    if (el instanceof HTMLDivElement) {
      listRef.current = el;
      el.focus();
    }
  }, [listRef, listId]);
  return null;
}
