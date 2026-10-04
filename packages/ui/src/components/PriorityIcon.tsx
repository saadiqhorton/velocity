import clsx from 'clsx';
import { Icon } from './Icon';
import type { IconSize } from './Icon';
import type { IconName } from '../icons';

export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

const config: Record<Priority, { icon: IconName; color: string; name: string }> = {
  urgent: { icon: 'priority-urgent', color: 'text-danger-fg', name: 'Urgent priority' },
  high: { icon: 'priority-high', color: 'text-warning-fg', name: 'High priority' },
  medium: { icon: 'priority-medium', color: 'text-link', name: 'Medium priority' },
  low: { icon: 'priority-low', color: 'text-fg-subtle', name: 'Low priority' },
  none: { icon: 'priority-none', color: 'text-fg-subtle', name: 'No priority' },
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
  className?: string;
}

export function PriorityIcon({ priority, size = 16, className }: PriorityIconProps) {
  const c = config[priority];
  return <Icon name={c.icon} size={size} label={c.name} className={clsx(c.color, className)} />;
}
