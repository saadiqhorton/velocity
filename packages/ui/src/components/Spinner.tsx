import clsx from 'clsx';

export interface SpinnerProps {
  size?: 16 | 20 | 24;
  /** Accessible name; set to an empty string to render decoratively. */
  label?: string;
  className?: string;
}

export function Spinner({ size = 16, label = 'Loading', className }: SpinnerProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      className={clsx('shrink-0 animate-spin', className)}
      role={label ? 'status' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
