import type { CSSProperties } from 'react';
import clsx from 'clsx';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** Render several text-line placeholders. */
  rows?: number;
  className?: string;
}

/** Route-level loading placeholder. */
export function Skeleton({ width, height = 16, rows, className }: SkeletonProps) {
  const block = (style: CSSProperties, key?: number) => (
    <div key={key} aria-hidden="true" className={clsx('rounded-sm bg-neutral', className)} style={style} />
  );
  if (rows && rows > 0) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">Loading</span>
        {Array.from({ length: rows }, (_, i) => block({ width: i === rows - 1 && rows > 1 ? '60%' : width ?? '100%', height }, i))}
      </div>
    );
  }
  return block({ width: width ?? '100%', height });
}
