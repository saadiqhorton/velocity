import type { ReactNode } from 'react';
import { PRODUCT_NAME } from '@velocity/ui';

/** Centered auth card on the sunken canvas. No top bar, no marketing copy (SPEC §4.14). */
export function AuthLayout({ title, subtitle, children, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex h-full overflow-y-auto bg-sunken">
      <main className="m-auto flex w-full flex-col items-center gap-6 px-4 py-12">
        <div className="text-base font-semibold text-fg-subtle" aria-hidden="true">
          {PRODUCT_NAME}
        </div>
        <div className={`w-full ${wide ? 'max-w-120' : 'max-w-100'} rounded-md border border-border bg-surface p-8`}>
          <h1 className="text-xl font-semibold text-fg">{title}</h1>
          {subtitle ? <div className="mt-1 text-base text-fg-subtle">{subtitle}</div> : null}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
