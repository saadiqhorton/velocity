import { cloneElement, createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent, ReactElement, ReactNode, Ref } from 'react';
import clsx from 'clsx';
import { Icon } from './Icon';
import { Popover } from './Popover';
import type { Placement } from './Popover';
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
        className={clsx('min-w-48 py-1 text-base', className)}
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
        <div id={id} className="px-3 py-1 text-xs font-semibold uppercase text-fg-subtle">
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
}

const itemClass = (danger: boolean | undefined, disabled: boolean | undefined) =>
  clsx(
    'flex h-8 w-full items-center gap-2 px-3 text-left transition-colors duration-100',
    disabled ? 'cursor-not-allowed text-fg-disabled' : danger ? 'text-danger-fg hover:bg-danger-subtle focus:bg-danger-subtle' : 'text-fg hover:bg-hover focus:bg-hover',
  );

export function MenuItem({ children, onSelect, icon, shortcut, danger, disabled, keepOpen }: MenuItemProps) {
  const ctx = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
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
    </button>
  );
}

export interface MenuSeparatorProps {
  className?: string;
}
export function MenuSeparator({ className }: MenuSeparatorProps) {
  return <div role="separator" className={clsx('my-1 border-t border-border', className)} />;
}

export interface SubMenuProps {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}

export function SubMenu({ label, icon, children }: SubMenuProps) {
  const ctx = useContext(MenuContext);
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = ctx.activeSub === id;
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
        <Icon name="chevron-right" className="text-fg-subtle" />
      </button>
      <Popover anchorEl={anchor} open={open} placement="right-start" offset={0} onKeyDown={(e) => e.stopPropagation()}>
        <MenuContext.Provider
          value={{
            ...ctx,
            closeSelf: () => {
              ctx.setActiveSub(null);
              anchor?.focus();
            },
          }}
        >
          <Menu aria-label={label} autoFocus={ctx.focusSub}>
            {children}
          </Menu>
        </MenuContext.Provider>
      </Popover>
    </>
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
