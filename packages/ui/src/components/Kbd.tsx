import type { ReactNode } from 'react';
import clsx from 'clsx';

export interface KbdProps {
  children?: ReactNode;
  /** Render several keys, e.g. ['G', 'B'] or ['Ctrl', 'K']. */
  keys?: string[];
  className?: string;
}

export function Kbd({ children, keys, className }: KbdProps) {
  const one = (k: ReactNode, i?: number) => (
    <kbd
      key={i}
      className={clsx(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-sunken px-1 font-mono text-xs text-fg-subtle',
        className,
      )}
    >
      {k}
    </kbd>
  );
  if (keys) return <span className="inline-flex items-center gap-1">{keys.map((k, i) => one(k, i))}</span>;
  return one(children);
}
