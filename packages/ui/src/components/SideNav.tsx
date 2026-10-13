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
    const els = Array.from(nav.querySelectorAll<HTMLElement>('[data-sidenav-item]')).filter((el) => el.offsetParent !== null);
    const idx = els.indexOf(document.activeElement as HTMLElement);
    if (idx === -1) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? Math.min(idx + 1, els.length - 1) : Math.max(idx - 1, 0);
    els[next]?.focus();
  };
  return (
    <nav {...rest} onKeyDown={handle} className={clsx('flex flex-col gap-px', className)}>
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
  /** Router link target, forwarded when `as` is a router link component. */
  to?: string;
  /** Custom element or router link component. */
  as?: ElementType;
  onClick?: MouseEventHandler<HTMLElement>;
  /** Indent level for nested items (team sub-pages). */
  level?: 0 | 1;
  className?: string;
  title?: string;
  draggable?: boolean;
  'data-testid'?: string;
}

/**
 * Side navigation item (SPEC §4.9.15): rest = subtle text with muted icon; hover = hover
 * surface; pressed = pressed surface; selected = neutral fill, full-strength text and
 * icon, weight 500. 28px rows keep the sidebar at list density (§4.10).
 */
export const SideNavItem = forwardRef<HTMLElement, SideNavItemProps>(function SideNavItem(
  { children, icon, trailing, selected = false, href, to, as, onClick, level = 0, className, ...rest },
  ref,
) {
  const Comp: ElementType = as ?? (href ? 'a' : 'button');
  const extra: Record<string, unknown> = !as && !href ? { type: 'button' } : {};
  if (to !== undefined) extra.to = to;
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
        'group/navitem relative flex h-7 w-full shrink-0 select-none items-center gap-2 rounded-sm pr-2 text-left text-base transition-colors duration-100',
        'focus-visible:-outline-offset-2',
        level === 1 ? 'pl-7' : 'pl-2',
        selected ? 'bg-neutral font-medium text-fg' : 'text-fg-subtle hover:bg-hover hover:text-fg active:bg-pressed',
        className,
      )}
    >
      {icon ? (
        <span
          className={clsx(
            'inline-flex w-4 shrink-0 items-center justify-center transition-colors duration-100',
            selected ? 'text-icon' : 'text-icon-subtle group-hover/navitem:text-icon',
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Comp>
  );
});

export interface SideNavGroupProps {
  title: ReactNode;
  /** Accessible name when `title` is not plain text. */
  label?: string;
  icon?: ReactNode;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  /** Persistence is the app's job. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Trailing content in the header row (e.g. an add button). Rendered outside the toggle. */
  actions?: ReactNode;
  /** `section` = small subtle heading (Teams, Projects); `item` = nav-weight row (a team). */
  variant?: 'section' | 'item';
  children: ReactNode;
  className?: string;
}

export function SideNavGroup({
  title,
  label,
  icon,
  collapsed,
  defaultCollapsed = false,
  onCollapsedChange,
  actions,
  variant = 'section',
  children,
  className,
}: SideNavGroupProps) {
  const id = useId();
  const [isCollapsed, setCollapsed] = useControllableState(collapsed, defaultCollapsed, onCollapsedChange);
  const name = label ?? (typeof title === 'string' ? title : undefined);
  return (
    <div className={clsx('flex flex-col gap-px', className)}>
      <div className="group/navgroup relative flex items-center">
        <button
          type="button"
          data-sidenav-item=""
          aria-expanded={!isCollapsed}
          aria-controls={id}
          onClick={() => setCollapsed(!isCollapsed)}
          className={clsx(
            'flex w-full min-w-0 select-none items-center gap-1.5 rounded-sm px-2 text-left transition-colors duration-100 hover:bg-hover focus-visible:-outline-offset-2',
            variant === 'section'
              ? 'h-6 text-sm font-medium text-fg-subtlest hover:text-fg-subtle'
              : 'h-7 gap-2 text-base text-fg-subtle hover:text-fg active:bg-pressed',
          )}
        >
          {icon ? <span className="inline-flex w-4 shrink-0 items-center justify-center">{icon}</span> : null}
          <span className="min-w-0 truncate">{title}</span>
          <Icon
            name="chevron-down"
            className={clsx(
              'h-3 w-3 shrink-0 transition-transform duration-150',
              isCollapsed && '-rotate-90',
              variant === 'section' ? 'opacity-60' : 'opacity-0 group-hover/navgroup:opacity-60',
            )}
          />
        </button>
        {actions ? <div className="absolute right-1 flex items-center">{actions}</div> : null}
      </div>
      <div id={id} role="group" aria-label={name} hidden={isCollapsed} className="flex flex-col gap-px">
        {isCollapsed ? null : children}
      </div>
    </div>
  );
}
