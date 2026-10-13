import clsx from 'clsx';
import type { IconSize } from './Icon';

export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

/**
 * Fixed priority mapping (SPEC §4.7, amended): Urgent = filled rounded square with "!",
 * High/Medium/Low = three signal bars with 3/2/1 filled, None = three dashes. Unfilled
 * bars sit at low opacity so the level reads at a glance; only Urgent carries color.
 */
const config: Record<Priority, { color: string; name: string; level: number }> = {
  urgent: { color: 'text-danger-fg', name: 'Urgent priority', level: 3 },
  high: { color: 'text-fg-subtle', name: 'High priority', level: 3 },
  medium: { color: 'text-fg-subtle', name: 'Medium priority', level: 2 },
  low: { color: 'text-fg-subtle', name: 'Low priority', level: 1 },
  none: { color: 'text-fg-subtlest', name: 'No priority', level: 0 },
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
          <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="currentColor" />
          <path d="M8 4.5v4.25" stroke="var(--ds-color-surface)" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="8" cy="11.25" r="1" fill="var(--ds-color-surface)" />
        </>
      ) : priority === 'none' ? (
        <path d="M2.5 8h2M7 8h2M11.5 8h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        [
          { x: 2, y: 9, h: 5 },
          { x: 6.5, y: 5.5, h: 8.5 },
          { x: 11, y: 2, h: 12 },
        ].map((bar, i) => (
          <rect
            key={i}
            x={bar.x}
            y={bar.y}
            width="3"
            height={bar.h}
            rx="1"
            fill="currentColor"
            opacity={i < c.level ? 1 : 0.3}
          />
        ))
      )}
    </svg>
  );
}
