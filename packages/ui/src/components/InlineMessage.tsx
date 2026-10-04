import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from './Icon';
import { IconButton } from './Button';
import type { IconName } from '../icons';

export type MessageAppearance = 'info' | 'warning' | 'error' | 'success' | 'discovery';

const config: Record<MessageAppearance, { bg: string; fg: string; icon: IconName }> = {
  info: { bg: 'bg-information-subtle', fg: 'text-link', icon: 'info' },
  warning: { bg: 'bg-warning-subtle', fg: 'text-warning-fg', icon: 'warning' },
  error: { bg: 'bg-danger-subtle', fg: 'text-danger-fg', icon: 'error' },
  success: { bg: 'bg-success-subtle', fg: 'text-success-fg', icon: 'success' },
  discovery: { bg: 'bg-discovery-subtle', fg: 'text-discovery-fg', icon: 'sparkle' },
};

export interface InlineMessageProps {
  appearance?: MessageAppearance;
  title?: string;
  children?: ReactNode;
  /** Optional action (Button variant link/subtle). */
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

function MessageBase({ appearance = 'info', title, children, action, onDismiss, className }: InlineMessageProps) {
  const c = config[appearance];
  const urgent = appearance === 'error' || appearance === 'warning';
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={clsx('flex items-start gap-2 rounded-sm px-3 py-2 text-sm text-fg', c.bg, className)}
    >
      <Icon name={c.icon} className={clsx('mt-0.5', c.fg)} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action}
      {onDismiss ? <IconButton label="Dismiss" size="sm" icon={<Icon name="close" />} onClick={onDismiss} /> : null}
    </div>
  );
}

/** Compact in-context message (form sections, permission notices). */
export function InlineMessage(props: InlineMessageProps) {
  return <MessageBase {...props} />;
}

/** Full-width message with optional action and dismiss (offline state, cycle warnings). */
export function Banner(props: InlineMessageProps) {
  return <MessageBase {...props} className={clsx('w-full', props.className)} />;
}
