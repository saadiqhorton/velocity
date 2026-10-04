import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import type { StatusColor } from '@velocity/tokens';

export type LozengeAppearance = 'default' | 'success' | 'removed' | 'inprogress' | 'new' | 'moved';

const appearanceColor: Record<LozengeAppearance, StatusColor> = {
  default: 'grey',
  success: 'green',
  removed: 'red',
  inprogress: 'blue',
  new: 'purple',
  moved: 'yellow',
};

export interface LozengeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  appearance?: LozengeAppearance;
  /** Palette color; overrides `appearance`. */
  color?: StatusColor;
  children: ReactNode;
}

export function Lozenge({ appearance = 'default', color, className, style, children, ...rest }: LozengeProps) {
  const c = color ?? appearanceColor[appearance];
  return (
    <span
      {...rest}
      className={clsx('inline-flex items-center whitespace-nowrap rounded-sm px-1 text-xs font-semibold', className)}
      style={{ backgroundColor: `var(--ds-status-${c}-bg)`, color: `var(--ds-status-${c}-text)`, ...style }}
    >
      {children}
    </span>
  );
}

export interface StatusDotProps {
  color: StatusColor;
  /** Accessible name; omit when the adjacent text names the status. */
  label?: string;
  className?: string;
}

/** 6px status color dot. */
export function StatusDot({ color, label, className }: StatusDotProps) {
  return (
    <span
      className={clsx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: `var(--ds-status-${color})` }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
