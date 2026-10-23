import { cloneElement, createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent, ReactElement, ReactNode, Ref } from 'react';
import clsx from 'clsx';
import { Icon } from './Icon';
import { Popover } from './Popover';
import type { Placement } from './Popover';
import { PopupSelectPanel } from './PopupSelect';
import type { PopupOption } from './OptionList';
import { mergeRefs, useControllableState } from '../utils/react';

interface MenuContextValue {
  /** Close the whole menu tree. */
  closeAll: (restoreFocus: boolean) => void;
  /** Close this (sub)menu and return focus to its parent item. */
  closeSelf?: () => void;
  activeSub: string | null;
  setActiveSub: (id: string | null, focus?: boolean) => void;
  focusSub: boolean;
}

const MenuContext = createContext<MenuContextValue>({
  closeAll: () => undefined,
  activeSub: null,
  setActiveSub: () => undefined,
  focusSub: false,
});

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';

export interface MenuProps {
  children: ReactNode;
  'aria-label'?: string;
  /** Focus the first item on mount. */
  autoFocus?: boolean;
  className?: string;
}

/** The menu list itself (role="menu"). Use inside DropdownMenu or render statically. */
export function Menu({ children, autoFocus = false, className, ...rest }: MenuProps) {
  const parent = useContext(MenuContext);
  const ref = useRef<HTMLDivElement | null>(null);
  const [activeSub, setActiveSubState] = useState<string | null>(null);
  const [focusSub, setFocusSub] = useState(false);
  const typeahead = useRef({ buffer: '', timer: undefined as ReturnType<typeof setTimeout> | undefined });

  const items = useCallback(
    () => Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []).filter((el) => el.closest('[role="menu"]') === ref.current),
    [],
  );

  useEffect(() => {
    if (autoFocus) items()[0]?.focus();
  }, [autoFocus, items]);

  useEffect(() => {
    const t = typeahead.current;
    return () => clearTimeout(t.timer);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[role="menu"]') !== ref.current) return;
    const list = items();
    const idx = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        focusAt(idx + 1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        focusAt(idx === -1 ? -1 : idx - 1);
        return;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        return;
      case 'End':
        e.preventDefault();
        focusAt(-1);
        return;
      case 'ArrowRight': {
        const el = list[idx];
        if (el?.getAttribute('aria-haspopup') === 'menu') {
          e.preventDefault();
          e.stopPropagation();
          setFocusSub(true);
          setActiveSubState(el.dataset.submenuId ?? null);
        }
        return;
      }
      case 'ArrowLeft':
        if (parent.closeSelf) {
          e.preventDefault();
          e.stopPropagation();
          parent.closeSelf();
        }
        return;
      case 'Enter':
      case ' ': {
        const el = list[idx];
        if (el) {
          e.preventDefault();
          e.stopPropagation();
          el.click();
        }
        return;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (parent.closeSelf) parent.closeSelf();
        else parent.closeAll(true);
        return;
      case 'Tab':
        parent.closeAll(false);
        return;
      default:
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = typeahead.current;
      clearTimeout(t.timer);
      t.buffer += e.key.toLowerCase();
      t.timer = setTimeout(() => {
        t.buffer = '';
      }, 500);
      const ordered = [...list.slice(idx + 1), ...list.slice(0, idx + 1)];
      const match = ordered.find((el) => (el.textContent ?? '').trim().toLowerCase().startsWith(t.buffer));
      match?.focus();
    }
  };

  return (
    <MenuContext.Provider
      value={{
        closeAll: parent.closeAll,
        closeSelf: parent.closeSelf,
        activeSub,
        focusSub,
        setActiveSub: (id, focus = false) => {
          setFocusSub(focus);
          setActiveSubState(id);
        },
      }}
    >
      <div
        role="menu"
        aria-label={rest['aria-label']}
        ref={ref}
        onKeyDown={onKeyDown}
        className={clsx('min-w-48 p-1 text-base', className)}
      >
        {children}
      </div>
    </MenuContext.Provider>
  );
}

export interface MenuGroupProps {
  heading?: string;
  children: ReactNode;
}

export function MenuGroup({ heading, children }: MenuGroupProps) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={heading ? id : undefined} className="not-first:mt-1 not-first:border-t not-first:border-border not-first:pt-1">
      {heading ? (
        <div id={id} className="px-2 py-1 text-sm font-medium text-fg-subtlest">
          {heading}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export interface MenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  /** Trailing shortcut hint. */
  shortcut?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Keep the menu open after selecting. */
  keepOpen?: boolean;
  /** Navigation menus: marks the item for the current page (`aria-current="page"` and a trailing check). */
  current?: boolean;
}

const itemClass = (danger: boolean | undefined, disabled: boolean | undefined) =>
  clsx(
    'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors duration-100 focus-visible:outline-none',
    disabled
      ? 'text-fg-disabled'
      : danger
        ? 'text-danger-fg hover:bg-danger-subtle focus:bg-danger-subtle active:bg-pressed'
        : 'text-fg hover:bg-neutral-hover focus:bg-neutral-hover active:bg-pressed',
  );

export function MenuItem({ children, onSelect, icon, shortcut, danger, disabled, keepOpen, current }: MenuItemProps) {
  const ctx = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      aria-current={current ? 'page' : undefined}
      onMouseEnter={() => ctx.setActiveSub(null)}
      onClick={() => {
        if (disabled) return;
        onSelect?.();
        if (!keepOpen) ctx.closeAll(true);
      }}
      className={itemClass(danger, disabled)}
    >
      {icon ? <span className="inline-flex w-5 shrink-0 justify-center">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? <span className="text-sm text-fg-subtle">{shortcut}</span> : null}
      {current ? <Icon name="check" className="shrink-0 text-fg-selected" /> : null}
    </button>
  );
}

export interface MenuSeparatorProps {
  className?: string;
}
export function MenuSeparator({ className }: MenuSeparatorProps) {
  return <div role="separator" className={clsx('-mx-1 my-1 border-t border-border', className)} />;
}

export interface SubMenuProps {
  label: string;
  icon?: ReactNode;
  /** Trailing shortcut hint on the trigger, before the chevron. */
  shortcut?: ReactNode;
  children: ReactNode;
}

interface SubMenuFrameProps {
  label: string;
  icon?: ReactNode;
  shortcut?: ReactNode;
  /** The popup content. `focusFirst` is true when the submenu was opened from the keyboard. */
  children: (panel: { focusFirst: boolean; closeSelf: () => void }) => ReactNode;
}

/** The trigger row and its popup; SubMenu and OptionSubMenu differ only in the panel they render. */
function SubMenuFrame({ label, icon, shortcut, children }: SubMenuFrameProps) {
  const ctx = useContext(MenuContext);
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = ctx.activeSub === id;
  const closeSelf = () => {
    ctx.setActiveSub(null);
    anchor?.focus();
  };
  return (
    <>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        ref={setAnchor}
        data-submenu-id={id}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseEnter={() => ctx.setActiveSub(id, false)}
        onClick={() => ctx.setActiveSub(id, true)}
        className={itemClass(false, false)}
      >
        {icon ? <span className="inline-flex w-5 shrink-0 justify-center">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {shortcut ? <span className="text-sm text-fg-subtle">{shortcut}</span> : null}
        <Icon name="chevron-right" className="text-fg-subtle" />
      </button>
      <Popover anchorEl={anchor} open={open} placement="right-start" offset={0} onKeyDown={(e) => e.stopPropagation()}>
        <MenuContext.Provider value={{ ...ctx, closeSelf }}>{children({ focusFirst: ctx.focusSub, closeSelf })}</MenuContext.Provider>
      </Popover>
    </>
  );
}

export function SubMenu({ label, icon, shortcut, children }: SubMenuProps) {
  return (
    <SubMenuFrame label={label} icon={icon} shortcut={shortcut}>
      {({ focusFirst }) => (
        <Menu aria-label={label} autoFocus={focusFirst}>
          {children}
        </Menu>
      )}
    </SubMenuFrame>
  );
}

interface OptionSubMenuBase {
  label: string;
  icon?: ReactNode;
  shortcut?: ReactNode;
  options: PopupOption[];
  /** Adds a type-to-filter input above the list. */
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export type OptionSubMenuProps = OptionSubMenuBase &
  (
    | { multiple?: false; value: string | null; onChange: (value: string) => void }
    | { multiple: true; value: string[]; onChange: (values: string[]) => void }
  );

/**
 * A submenu whose panel is a picker list (check marks, digit quick select, optional filter).
 * Single select applies and closes the whole menu; multiple select reports each toggle and stays open.
 */
export function OptionSubMenu(props: OptionSubMenuProps) {
  const { label, icon, shortcut, options, searchable = false, searchPlaceholder = 'Search', emptyMessage } = props;
  const selected = Array.isArray(props.value) ? props.value : props.value ? [props.value] : [];
  const onPick = (values: string[]) => {
    if (props.multiple === true) props.onChange(values);
    else props.onChange(values[0] ?? '');
  };
  return (
    <SubMenuFrame label={label} icon={icon} shortcut={shortcut}>
      {({ focusFirst, closeSelf }) => (
        <OptionSubMenuPanel
          label={label}
          options={options}
          selected={selected}
          multiple={props.multiple === true}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
          emptyMessage={emptyMessage}
          focusFirst={focusFirst}
          closeSelf={closeSelf}
          onPick={onPick}
        />
      )}
    </SubMenuFrame>
  );
}

interface OptionSubMenuPanelProps {
  label: string;
  options: PopupOption[];
  selected: string[];
  multiple: boolean;
  searchable: boolean;
  searchPlaceholder: string;
  emptyMessage?: string;
  focusFirst: boolean;
  closeSelf: () => void;
  onPick: (values: string[]) => void;
}

function OptionSubMenuPanel({
  label,
  options,
  selected: initial,
  multiple,
  searchable,
  searchPlaceholder,
  emptyMessage,
  focusFirst,
  closeSelf,
  onPick,
}: OptionSubMenuPanelProps) {
  const ctx = useContext(MenuContext);
  const listId = useId();
  // Local state so the checks follow multi-select toggles. The panel mounts on each open, so it starts from `initial`.
  const [selected, setSelected] = useState(initial);
  const choose = (option: PopupOption) => {
    if (!multiple) {
      onPick([option.value]);
      ctx.closeAll(true);
      return;
    }
    const next = selected.includes(option.value) ? selected.filter((v) => v !== option.value) : [...selected, option.value];
    setSelected(next);
    onPick(next);
  };
  return (
    <div
      onKeyDown={(e) => {
        // ArrowLeft closes the submenu, except while the filter has text (then it moves the caret).
        if (e.key !== 'ArrowLeft' || (e.target instanceof HTMLInputElement && e.target.value !== '')) return;
        e.preventDefault();
        e.stopPropagation();
        closeSelf();
      }}
    >
      <PopupSelectPanel
        listId={listId}
        label={label}
        options={options}
        selected={selected}
        multiple={multiple}
        searchable={searchable}
        searchPlaceholder={searchPlaceholder}
        emptyMessage={emptyMessage}
        onSelectOption={choose}
        onClose={() => closeSelf()}
        autoFocus={focusFirst}
      />
    </div>
  );
}

interface TriggerProps {
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  'aria-haspopup'?: string;
  'aria-expanded'?: boolean;
}

export interface DropdownMenuProps {
  /** Single element (Button / IconButton) that toggles the menu. */
  trigger: ReactElement<TriggerProps>;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: Placement;
  'aria-label'?: string;
}

export function DropdownMenu({ trigger, children, open, defaultOpen = false, onOpenChange, placement = 'bottom-start', ...rest }: DropdownMenuProps) {
  const [isOpen, setOpen] = useControllableState(open, defaultOpen, onOpenChange);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [focusFirst, setFocusFirst] = useState(true);
  const triggerRef = (trigger as ReactElement & { ref?: Ref<HTMLElement> }).ref;
  const tp = trigger.props;

  const closeAll = useCallback(
    (restore: boolean) => {
      setOpen(false);
      if (restore) anchor?.focus();
    },
    [setOpen, anchor],
  );

  const el = cloneElement(trigger, {
    ref: mergeRefs<HTMLElement>(triggerRef, setAnchor),
    'aria-haspopup': 'menu',
    'aria-expanded': isOpen,
    onClick: (e: MouseEvent<HTMLElement>) => {
      tp.onClick?.(e);
      setFocusFirst(e.detail === 0);
      setOpen(!isOpen);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      tp.onKeyDown?.(e);
      if (e.key === 'ArrowDown' && !isOpen) {
        e.preventDefault();
        setFocusFirst(true);
        setOpen(true);
      }
    },
  } as Partial<TriggerProps> & { ref: Ref<HTMLElement> });

  return (
    <>
      {el}
      <Popover
        anchorEl={anchor}
        open={isOpen}
        placement={placement}
        onDismiss={() => closeAll(false)}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <MenuContext.Provider value={{ closeAll, activeSub: null, setActiveSub: () => undefined, focusSub: false }}>
          <Menu aria-label={rest['aria-label']} autoFocus={focusFirst}>
            {children}
          </Menu>
        </MenuContext.Provider>
      </Popover>
    </>
  );
}
