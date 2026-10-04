import { useState } from 'react';
import clsx from 'clsx';
import { Icon } from './Icon';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /** Collapse the middle beyond this many levels. */
  maxItems?: number;
  className?: string;
}

export function Breadcrumbs({ items, maxItems = 4, className }: BreadcrumbsProps) {
  const [expanded, setExpanded] = useState(false);
  const collapse = !expanded && items.length > maxItems;
  const visible: Array<BreadcrumbItem | 'ellipsis'> = collapse
    ? [items[0] as BreadcrumbItem, 'ellipsis', ...items.slice(items.length - (maxItems - 2))]
    : items;
  const lastIndex = visible.length - 1;
  return (
    <nav aria-label="Breadcrumbs" className={className}>
      <ol className="flex items-center gap-1 text-base">
        {visible.map((item, i) => {
          const isLast = i === lastIndex;
          return (
            <li key={item === 'ellipsis' ? 'ellipsis' : `${i}-${item.label}`} className="flex items-center gap-1">
              {item === 'ellipsis' ? (
                <button
                  type="button"
                  aria-label="Show all levels"
                  onClick={() => setExpanded(true)}
                  className="rounded-sm px-1 text-fg-subtle hover:bg-hover"
                >
                  …
                </button>
              ) : isLast ? (
                <span aria-current="page" className="font-semibold text-fg">
                  {item.label}
                </span>
              ) : item.href ? (
                <a href={item.href} onClick={item.onClick} className="text-fg-subtle hover:text-fg hover:underline">
                  {item.label}
                </a>
              ) : (
                <button type="button" onClick={item.onClick} className="text-fg-subtle hover:text-fg hover:underline">
                  {item.label}
                </button>
              )}
              {!isLast ? <Icon name="chevron-right" className={clsx('text-fg-subtlest')} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
