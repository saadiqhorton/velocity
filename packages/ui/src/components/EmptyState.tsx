import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from './Icon';
import type { IconName } from '../icons';

export interface EmptyStateProps {
  icon?: IconName;
  /** One sentence. */
  message: string;
  /** Primary action, typically a Button. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon = 'inbox', message, action, className }: EmptyStateProps) {
  return (
    <div className={clsx('flex flex-col items-center gap-3 px-4 py-8 text-center', className)}>
      <Icon name={icon} size={24} className="text-fg-subtlest" />
      <p className="text-base text-fg-subtle">{message}</p>
      {action}
    </div>
  );
}
