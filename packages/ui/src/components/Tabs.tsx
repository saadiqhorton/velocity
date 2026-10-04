import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import clsx from 'clsx';
import { useControllableState } from '../utils/react';

export interface TabItem {
  id: string;
  label: ReactNode;
  panel?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  'aria-label': string;
  className?: string;
}

export function Tabs({ items, value, defaultValue, onChange, className, ...rest }: TabsProps) {
  const base = useId();
  const [current, setCurrent] = useControllableState<string>(value, defaultValue ?? items.find((i) => !i.disabled)?.id ?? '', onChange);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = items.filter((i) => !i.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = enabled.findIndex((i) => i.id === current);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = enabled[next];
    if (!target) return;
    setCurrent(target.id);
    refs.current[target.id]?.focus();
  };

  const active = items.find((i) => i.id === current);
  return (
    <div className={className}>
      <div role="tablist" aria-label={rest['aria-label']} onKeyDown={onKeyDown} className="flex gap-4 border-b border-border">
        {items.map((item) => {
          const selected = item.id === current;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[item.id] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => setCurrent(item.id)}
              className={clsx(
                '-mb-px h-8 border-b-2 text-base transition-colors duration-100 disabled:cursor-not-allowed disabled:text-fg-disabled',
                selected ? 'border-primary font-medium text-fg-selected' : 'border-transparent text-fg-subtle hover:text-fg',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {active?.panel !== undefined ? (
        <div role="tabpanel" id={`${base}-panel-${active.id}`} aria-labelledby={`${base}-tab-${active.id}`} tabIndex={0} className="pt-4">
          {active.panel}
        </div>
      ) : null}
    </div>
  );
}
