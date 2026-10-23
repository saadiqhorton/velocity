import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Button, Icon, IconButton } from '@velocity/ui';
import { useSidebar } from '@/stores/sidebar';
import { useUi } from '@/stores/ui';
import type { CreateDefaults } from '@/stores/ui';
import { useShortcutKeys } from '@/lib/shortcutKeys';
import { m } from '@/i18n';

export interface ViewHeaderCrumb {
  label: ReactNode;
  to: string;
  icon?: ReactNode;
}

export interface ViewHeaderProps {
  title: ReactNode;
  icon?: ReactNode;
  /** Ancestors shown before the title as links (team › Projects › title). */
  breadcrumbs?: ViewHeaderCrumb[];
  count?: number | null;
  /** Filter chips, tabs or pickers shown after the title. */
  children?: ReactNode;
  /** Right-side controls before the primary button (display options, actions). */
  actions?: ReactNode;
  /** Defaults for the "+ New issue" primary button; `false` hides it. */
  create?: CreateDefaults | false;
  className?: string;
}

/**
 * View header (SPEC §4.10.2, amended): 44px — optional breadcrumb trail, title (13px
 * medium), muted count, filter chips, display options, and the one primary action,
 * "+ New issue" (28px). Not a top bar: it belongs to the content panel.
 */
export function ViewHeader({ title, icon, breadcrumbs, count, children, actions, create = {}, className }: ViewHeaderProps) {
  const openCreate = useUi((s) => s.openCreate);
  const setDrawerOpen = useSidebar((s) => s.setDrawerOpen);
  const createKeys = useShortcutKeys('issue.create');
  return (
    <header
      data-testid="view-header"
      className={clsx('flex h-11 shrink-0 items-center gap-2 border-b border-border pl-5 pr-3', className)}
    >
      <IconButton
        label={m.nav.openMenu}
        size="sm"
        icon={<Icon name="sidebar" />}
        className="md:hidden"
        onClick={() => setDrawerOpen(true)}
      />
      <div className="flex min-w-0 shrink-0 items-center gap-1.5">
        {breadcrumbs?.length ? (
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-base">
            {breadcrumbs.map((c, i) => (
              <Fragment key={i}>
                <Link
                  to={c.to}
                  className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 font-medium text-fg-subtle transition-colors duration-100 hover:bg-hover hover:text-fg"
                >
                  {c.icon ? <span className="flex shrink-0 items-center">{c.icon}</span> : null}
                  <span className="truncate">{c.label}</span>
                </Link>
                <Icon name="chevron-right" className="h-3 w-3 shrink-0 text-fg-subtlest" />
              </Fragment>
            ))}
          </nav>
        ) : null}
        <div className={clsx('flex min-w-0 items-center gap-1.5', breadcrumbs?.length && 'px-1')}>
          {icon ? <span className="flex shrink-0 items-center">{icon}</span> : null}
          <h1 className="truncate text-base font-medium text-fg">{title}</h1>
        </div>
        {count !== undefined && count !== null ? (
          <span className="text-base tabular-nums text-fg-subtlest" data-testid="view-count">
            {count}
          </span>
        ) : null}
      </div>
      <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pl-2">{children}</div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        {create !== false ? (
          <Button
            variant="primary"
            size="sm"
            iconBefore={<Icon name="add" />}
            onClick={() => openCreate(create)}
            tooltip={m.issue.newIssue}
            shortcut={createKeys}
            aria-keyshortcuts="C"
            className="ml-1"
          >
            <span className="hidden sm:inline">{m.issue.newIssue}</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}
