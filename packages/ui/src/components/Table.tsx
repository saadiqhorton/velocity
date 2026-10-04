import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from './Icon';

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  /** Accessible header text if `header` is not plain text. */
  headerLabel?: string;
  sortable?: boolean;
  /** Used for built-in sorting when `sort` is uncontrolled. */
  sortValue?: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right';
  width?: number | string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  'aria-label': string;
  /** Controlled sort. When omitted the table sorts rows itself using `sortValue`. */
  sort?: SortState | null;
  defaultSort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  selectedKeys?: string[];
  /** Space toggles selection of the focused row. */
  onSelectionChange?: (keys: string[]) => void;
  /** Enter / click on a row. */
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
  stickyHeader?: boolean;
  maxHeight?: number | string;
  /**
   * Full-bleed table in a content region: the first and last columns pad to the view header's
   * 20px gutter so the table lines up with the title above it.
   */
  inset?: boolean;
  className?: string;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  sort,
  defaultSort = null,
  onSortChange,
  selectedKeys = [],
  onSelectionChange,
  onRowClick,
  emptyState,
  stickyHeader = true,
  maxHeight,
  inset = false,
  className,
  ...rest
}: TableProps<T>) {
  const [innerSort, setInnerSort] = useState<SortState | null>(defaultSort);
  const controlled = sort !== undefined;
  const activeSort = controlled ? sort : innerSort;
  const [focusIndex, setFocusIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

  const displayRows = useMemo(() => {
    if (controlled || !activeSort) return rows;
    const col = columns.find((c) => c.key === activeSort.key);
    const get = col?.sortValue;
    if (!get) return rows;
    const dir = activeSort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  }, [rows, columns, activeSort, controlled]);

  const toggleSort = (key: string) => {
    const next: SortState = {
      key,
      direction: activeSort?.key === key && activeSort.direction === 'asc' ? 'desc' : 'asc',
    };
    if (!controlled) setInnerSort(next);
    onSortChange?.(next);
  };

  const moveFocus = (i: number) => {
    const clamped = Math.max(0, Math.min(displayRows.length - 1, i));
    setFocusIndex(clamped);
    rowRefs.current[clamped]?.focus();
  };

  const onRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, index: number, row: T) => {
    if (e.target !== e.currentTarget) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveFocus(0);
        break;
      case 'End':
        e.preventDefault();
        moveFocus(displayRows.length - 1);
        break;
      case 'Enter':
        onRowClick?.(row);
        break;
      case ' ': {
        e.preventDefault();
        const key = rowKey(row);
        onSelectionChange?.(selectedKeys.includes(key) ? selectedKeys.filter((k) => k !== key) : [...selectedKeys, key]);
        break;
      }
      default:
    }
  };

  const safeFocus = Math.min(focusIndex, Math.max(0, displayRows.length - 1));

  return (
    <div className={clsx('overflow-auto', className)} style={{ maxHeight }}>
      <table role="grid" aria-label={rest['aria-label']} className="w-full min-w-160 border-separate border-spacing-0 text-base">
        <thead>
          <tr>
            {columns.map((col, ci) => {
              const sorted = activeSort?.key === col.key ? activeSort.direction : null;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={col.sortable ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : undefined}
                  style={{ width: col.width, zIndex: stickyHeader ? 'var(--ds-z-index-sticky)' : undefined }}
                  className={clsx(
                    'h-8 whitespace-nowrap bg-sunken px-3 text-xs font-semibold uppercase text-fg-subtle',
                    inset && ci === 0 && 'pl-5',
                    inset && ci === columns.length - 1 && 'pr-5',
                    col.align === 'right' ? 'text-right' : 'text-left',
                    stickyHeader && 'sticky top-0',
                  )}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 rounded-sm uppercase transition-colors duration-100 hover:text-fg"
                    >
                      {col.header}
                      {sorted ? <Icon name={sorted === 'asc' ? 'arrow-up' : 'arrow-down'} /> : null}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {displayRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="border-t border-border">
                {emptyState}
              </td>
            </tr>
          ) : (
            displayRows.map((row, index) => {
              const key = rowKey(row);
              const selected = selectedKeys.includes(key);
              return (
                <tr
                  key={key}
                  ref={(el) => {
                    rowRefs.current[index] = el;
                  }}
                  tabIndex={index === safeFocus ? 0 : -1}
                  aria-selected={selected}
                  onFocus={() => setFocusIndex(index)}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={(e) => onRowKeyDown(e, index, row)}
                  className={clsx(
                    'group transition-colors duration-100 focus-visible:-outline-offset-2',
                    onRowClick && 'cursor-pointer',
                    selected ? 'bg-primary-subtle' : 'hover:bg-sunken',
                  )}
                >
                  {columns.map((col, ci) => (
                    <td
                      key={col.key}
                      className={clsx(
                        'h-10 border-t border-border px-3',
                        col.align === 'right' && 'text-right',
                        ci === 0 && 'border-l-2',
                        inset && ci === 0 && 'pl-4.5',
                        inset && ci === columns.length - 1 && 'pr-5',
                        ci === 0 && (selected ? 'border-l-primary' : 'border-l-transparent'),
                      )}
                    >
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
