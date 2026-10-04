import clsx from 'clsx';

export interface BadgeProps {
  value: number;
  /** Values above max render as `max+`. */
  max?: number;
  appearance?: 'default' | 'primary' | 'danger';
  className?: string;
}

const appearanceClass = {
  default: 'bg-neutral text-fg',
  primary: 'bg-primary text-fg-inverse',
  danger: 'bg-danger text-fg-inverse',
} as const;

/** Count pill. */
export function Badge({ value, max = 99, appearance = 'default', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex h-4 min-w-4 items-center justify-center whitespace-nowrap rounded-full px-1 text-xs font-semibold',
        appearanceClass[appearance],
        className,
      )}
    >
      {value > max ? `${max}+` : value}
    </span>
  );
}
