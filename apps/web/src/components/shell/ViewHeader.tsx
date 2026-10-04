import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Button, Icon, IconButton } from '@velocity/ui';
import { useSidebar } from '@/stores/sidebar';
import { useUi } from '@/stores/ui';
import type { CreateDefaults } from '@/stores/ui';
import { m } from '@/i18n';

export interface ViewHeaderProps {
  title: ReactNode;
  icon?: ReactNode;
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
 * View header (SPEC §4.10.2): 48px — title (16px semibold), count badge, filter chips,
 * display options, and the one primary action, "+ New issue" (32px). Not a top bar: it
 * belongs to the content region and scrolls with the view's context.
 */
export function ViewHeader({ title, icon, count, children, actions, create = {}, className }: ViewHeaderProps) {
  const openCreate = useUi((s) => s.openCreate);
  const setDrawerOpen = useSidebar((s) => s.setDrawerOpen);
  return (
    <header
      data-testid="view-header"
      className={clsx('flex h-12 shrink-0 items-center gap-2 border-b border-border px-5', className)}
    >
      <IconButton
        label={m.nav.openMenu}
        size="sm"
        icon={<Icon name="sidebar" />}
        className="md:hidden"
        onClick={() => setDrawerOpen(true)}
      />
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        {icon ? <span className="flex shrink-0 items-center">{icon}</span> : null}
        <h1 className="truncate text-md font-semibold text-fg">{title}</h1>
        {count !== undefined && count !== null ? (
          <span className="rounded-sm bg-neutral px-1.5 text-sm font-medium text-fg-subtle" data-testid="view-count">
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
            size="md"
            iconBefore={<Icon name="add" />}
            onClick={() => openCreate(create)}
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
