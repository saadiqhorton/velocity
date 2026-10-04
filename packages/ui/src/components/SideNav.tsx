import { forwardRef, useId } from 'react';
import type { ElementType, HTMLAttributes, KeyboardEvent, MouseEventHandler, ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from './Icon';
import { useControllableState } from '../utils/react';

export interface SideNavProps extends HTMLAttributes<HTMLElement> {
  'aria-label': string;
}

/** Navigation landmark; ↑/↓ move focus across all items and group headers. */
export function SideNav({ children, className, onKeyDown, ...rest }: SideNavProps) {
  const handle = (e: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const nav = e.currentTarget;
    const els = Array.from(nav.querySelectorAll<HTMLElement>('[data-sidenav-item]'));
    const idx = els.indexOf(document.activeElement as HTMLElement);
    if (idx === -1) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? Math.min(idx + 1, els.length - 1) : Math.max(idx - 1, 0);
    els[next]?.focus();
  };
  return (
    <nav {...rest} onKeyDown={handle} className={clsx('flex flex-col gap-1', className)}>
      {children}
    </nav>
  );
}

export interface SideNavItemProps {
  children: ReactNode;
  icon?: ReactNode;
  /** Trailing content (count badge, shortcut hint). */
  trailing?: ReactNode;
  selected?: boolean;
  href?: string;
  /** Custom element or router link component. */
  as?: ElementType;
  onClick?: MouseEventHandler<HTMLElement>;
  className?: string;
}

export const SideNavItem = forwardRef<HTMLElement, SideNavItemProps>(function SideNavItem(
  { children, icon, trailing, selected = false, href, as, onClick, className, ...rest },
  ref,
) {
  const Comp: ElementType = as ?? (href ? 'a' : 'button');
  const extra = !as && !href ? { type: 'button' } : {};
  return (
    <Comp
      {...rest}
      {...extra}
      ref={ref}
      href={href}
      onClick={onClick}
      data-sidenav-item=""
      aria-current={selected ? 'page' : undefined}
      className={clsx(
        'flex h-8 w-full items-center gap-2 rounded-sm border-l-2 px-2 text-left text-base transition-colors duration-100',
        selected
          ? 'border-primary bg-raised font-medium text-fg-selected'
          : 'border-transparent text-fg-subtle hover:bg-hover hover:text-fg',
        className,
      )}
    >
      {icon ? <span className="inline-flex shrink-0 items-center">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Comp>
  );
});

export interface SideNavGroupProps {
  title: string;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  /** Persistence is the app's job. */
  onCollapsedChange?: (collapsed: boolean) => void;
  children: ReactNode;
  className?: string;
}

export function SideNavGroup({ title, collapsed, defaultCollapsed = false, onCollapsedChange, children, className }: SideNavGroupProps) {
  const id = useId();
  const [isCollapsed, setCollapsed] = useControllableState(collapsed, defaultCollapsed, onCollapsedChange);
  return (
    <div className={clsx('flex flex-col', className)}>
      <button
        type="button"
        data-sidenav-item=""
        aria-expanded={!isCollapsed}
        aria-controls={id}
        onClick={() => setCollapsed(!isCollapsed)}
        className="flex h-8 w-full items-center gap-1 rounded-sm px-2 text-left text-sm font-medium text-fg-subtle transition-colors duration-100 hover:bg-hover hover:text-fg"
      >
        <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} />
        <span className="truncate">{title}</span>
      </button>
      <div id={id} role="group" aria-label={title} hidden={isCollapsed} className="flex flex-col gap-0.5">
        {isCollapsed ? null : children}
      </div>
    </div>
  );
}
