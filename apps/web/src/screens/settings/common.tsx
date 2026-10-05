import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Breadcrumbs, Icon, IconButton, InlineMessage } from '@velocity/ui';
import type { BreadcrumbItem } from '@velocity/ui';
import { useWorkspace } from '@/app/workspace';
import { useSidebar } from '@/stores/sidebar';
import { m } from '@/i18n';
import { SettingsSectionMenu } from './nav';

export interface Crumb {
  label: string;
  /** In-app path; the last crumb is the current page and needs none. */
  to?: string;
}

export interface SettingsPageProps {
  /** Page title (also the last breadcrumb). */
  title: string;
  /** Crumbs between "Settings" and the title. */
  parents?: Crumb[];
  /** One short sentence under the title, only when it helps. */
  description?: ReactNode;
  /** Right side of the page title row (one primary action at most). */
  actions?: ReactNode;
  /** Wide pages (tables, audit log) use the full content width. */
  wide?: boolean;
  children: ReactNode;
  testId?: string;
}

/**
 * A settings page inside the content region (SPEC §4.11.9): a 48px breadcrumb header,
 * then a scrolling body with the page title and ADS form sections. No separate shell.
 */
export function SettingsPage({ title, parents = [], description, actions, wide, children, testId }: SettingsPageProps) {
  const navigate = useNavigate();
  const setDrawerOpen = useSidebar((s) => s.setDrawerOpen);
  const crumbs: BreadcrumbItem[] = [
    { label: m.settings.title, onClick: () => navigate('/settings') },
    ...parents.map((p) => ({ label: p.label, onClick: p.to ? () => navigate(p.to as string) : undefined })),
    { label: title },
  ];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid={testId ?? 'settings-page'}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-5" data-testid="view-header">
        <IconButton label={m.nav.openMenu} size="sm" icon={<Icon name="sidebar" />} className="md:hidden" onClick={() => setDrawerOpen(true)} />
        <Breadcrumbs items={crumbs} className="min-w-0" />
        <SettingsSectionMenu />
      </header>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {/* One left edge for every settings page; forms keep a readable measure inside the wide column. */}
        <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-8">
          <div className={clsx('flex flex-col gap-8', !wide && 'max-w-3xl')}>
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-semibold text-fg">{title}</h1>
                {description ? <p className="mt-1 text-base text-fg-subtle">{description}</p> : null}
              </div>
              {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface SettingsSectionProps {
  title: string;
  description?: ReactNode;
  /** Controls on the right of the section title (e.g. "Add label"). */
  actions?: ReactNode;
  children: ReactNode;
  /** Danger zone styling: a danger border around the body. */
  danger?: boolean;
  className?: string;
  testId?: string;
}

/** ADS form section: 14px semibold title, optional 12px helper, then the body. */
export function SettingsSection({ title, description, actions, children, danger, className, testId }: SettingsSectionProps) {
  return (
    <section className={clsx('flex flex-col gap-3', className)} data-testid={testId} aria-label={title}>
      <div className="flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-fg-subtle">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {/* Container query: rows stack label over control when the section is narrow (768, phones). */}
      <div className={clsx('@container rounded-md border', danger ? 'border-danger' : 'border-border')}>{children}</div>
    </section>
  );
}

export interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** The control (input, select, switch, button). */
  children: ReactNode;
  /** id of the control, so the label is clickable. */
  htmlFor?: string;
  className?: string;
}

/** One row inside a section: label + helper on the left, control on the right. Rows divide with a border. */
export function SettingsRow({ label, description, children, htmlFor, className }: SettingsRowProps) {
  return (
    <div
      className={clsx(
        'flex min-h-14 flex-col items-stretch gap-3 border-t border-border px-4 py-3 first:border-t-0 @lg:flex-row @lg:items-center @lg:gap-6',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-base font-medium text-fg">
            {label}
          </label>
        ) : (
          <div className="text-base font-medium text-fg">{label}</div>
        )}
        {description ? <div className="mt-0.5 text-sm text-fg-subtle">{description}</div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Body padding for free-form section content (forms, tables, lists). */
export function SectionBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('p-4', className)}>{children}</div>;
}

/** Read-only notice for members on owner-only pages (SPEC §3.2.3). */
export function OwnerOnlyNotice() {
  const { viewer } = useWorkspace();
  if (viewer.isOwner) return null;
  return <InlineMessage appearance="info">{m.settings.ownerOnly}</InlineMessage>;
}

export function useIsOwner(): boolean {
  return useWorkspace().viewer.isOwner;
}
