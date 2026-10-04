import { Skeleton } from '@velocity/ui';

/** Route-level loading state (SPEC §4.9.11): the shell's geometry with placeholder rows. */
export function ShellSkeleton() {
  return (
    <div className="flex h-full bg-surface" aria-busy="true">
      <div className="hidden h-full w-(--ds-layout-sidebar-compact) shrink-0 flex-col gap-3 border-r border-border bg-sunken px-4 py-4 md:flex xl:w-(--ds-layout-sidebar)">
        <Skeleton width="60%" height={16} />
        <Skeleton height={28} />
        <div className="mt-2 flex flex-col gap-2">
          <Skeleton width="70%" height={12} />
          <Skeleton width="55%" height={12} />
          <Skeleton width="65%" height={12} />
        </div>
      </div>
      <ContentSkeleton />
    </div>
  );
}

/**
 * Content placeholder. `header={false}` when the screen's real 48px header is already drawn
 * (lists, boards, tables), so the skeleton never stacks a second header under it.
 * Rows follow the issue-row anatomy: icon at the row's 32px inset, mono id, title.
 */
export function ContentSkeleton({ rows = 14, header = true }: { rows?: number; header?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col" role="status" aria-label="Loading">
      {header ? (
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
          <Skeleton width={120} height={16} />
          <Skeleton width={28} height={16} />
        </div>
      ) : null}
      <div className="flex flex-col pt-1">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-8 items-center gap-2 pl-8 pr-5">
            <Skeleton width={16} height={16} />
            <Skeleton width={52} height={12} />
            <Skeleton width={`${30 + ((i * 37) % 40)}%`} height={12} />
          </div>
        ))}
      </div>
    </div>
  );
}
