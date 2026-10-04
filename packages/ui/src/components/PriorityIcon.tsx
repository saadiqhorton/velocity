import clsx from 'clsx';
import type { IconSize } from './Icon';

export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

/**
 * Fixed priority mapping (SPEC §4.7): Urgent = alarm, High = arrow-up-circle,
 * Medium = arrow-right-circle, Low = arrow-down-circle, None = dash-circle.
 * Drawn with the same 1.5px stroke as StatusIcon so dense rows stay calm; only Urgent is
 * filled, so it is the one that draws the eye.
 */
const config: Record<Priority, { color: string; name: string }> = {
  urgent: { color: 'text-danger-fg', name: 'Urgent priority' },
  high: { color: 'text-warning-fg', name: 'High priority' },
  medium: { color: 'text-fg-subtle', name: 'Medium priority' },
  low: { color: 'text-fg-subtlest', name: 'Low priority' },
  none: { color: 'text-fg-subtlest', name: 'No priority' },
};

export const priorityNames: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No priority',
};

export interface PriorityIconProps {
  priority: Priority;
  size?: IconSize;
  /** Accessible name; defaults to "<Priority> priority". Pass '' when adjacent text names it. */
  label?: string;
  className?: string;
}

export function PriorityIcon({ priority, size = 16, label, className }: PriorityIconProps) {
  const c = config[priority];
  const name = label ?? c.name;
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      className={clsx('shrink-0', c.color, className)}
      role={name ? 'img' : undefined}
      aria-label={name || undefined}
      aria-hidden={name ? undefined : true}
      focusable="false"
      data-priority={priority}
    >
      {priority === 'urgent' ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M8 4.25v4.5" stroke="var(--ds-color-surface)" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="8" cy="11.25" r="1" fill="var(--ds-color-surface)" />
        </>
      ) : (
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      )}
      {priority === 'high' ? (
        <path d="M8 11V5.25M5.5 7.5 8 5l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
      {priority === 'medium' ? (
        <path d="M5 8h5.75M8.5 5.5 11 8l-2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
      {priority === 'low' ? (
        <path d="M8 5v5.75M5.5 8.5 8 11l2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
      {priority === 'none' ? <path d="M5.25 8h5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /> : null}
    </svg>
  );
}
