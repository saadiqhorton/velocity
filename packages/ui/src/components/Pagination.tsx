import clsx from 'clsx';
import { Icon } from './Icon';
import { IconButton } from './Button';

export interface PaginationProps {
  /** 1-based current page. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  siblings?: number;
  className?: string;
}

export function getPageItems(page: number, count: number, siblings: number): Array<number | 'gap-start' | 'gap-end'> {
  const total = siblings * 2 + 5;
  if (count <= total) return Array.from({ length: count }, (_, i) => i + 1);
  const left = Math.max(page - siblings, 2);
  const right = Math.min(page + siblings, count - 1);
  const items: Array<number | 'gap-start' | 'gap-end'> = [1];
  if (left > 2) items.push('gap-start');
  for (let i = left; i <= right; i++) items.push(i);
  if (right < count - 1) items.push('gap-end');
  items.push(count);
  return items;
}

export function Pagination({ page, pageCount, onPageChange, siblings = 1, className }: PaginationProps) {
  const items = getPageItems(page, pageCount, siblings);
  return (
    <nav aria-label="Pagination" className={clsx('flex items-center gap-1', className)}>
      <IconButton
        label="Previous page"
        icon={<Icon name="chevron-left" />}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      />
      {items.map((item) =>
        typeof item === 'number' ? (
          <button
            key={item}
            type="button"
            aria-label={`Page ${item}`}
            aria-current={item === page ? 'page' : undefined}
            onClick={() => onPageChange(item)}
            className={clsx(
              'h-8 min-w-8 rounded-sm px-2 text-base transition-colors duration-100',
              item === page ? 'bg-primary-subtle font-semibold text-fg-selected' : 'text-fg-subtle hover:bg-hover',
            )}
          >
            {item}
          </button>
        ) : (
          <span key={item} aria-hidden="true" className="inline-flex h-8 min-w-8 items-center justify-center text-fg-subtle">
            …
          </span>
        ),
      )}
      <IconButton
        label="Next page"
        icon={<Icon name="chevron-right" />}
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      />
    </nav>
  );
}
