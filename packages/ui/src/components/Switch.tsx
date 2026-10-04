import { forwardRef, useId } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import { useControllableState } from '../utils/react';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'value'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Visible label. Provide this or `aria-label`. */
  label?: ReactNode;
}

/** 32x18 switch. Immediate-effect settings only; never use for form submission state. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, defaultChecked = false, onChange, label, disabled, className, id, ...rest },
  ref,
) {
  const generated = useId();
  const buttonId = id ?? generated;
  const [on, setOn] = useControllableState(checked, defaultChecked, onChange);
  const control = (
    <button
      {...rest}
      id={buttonId}
      ref={ref}
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={(e) => {
        rest.onClick?.(e);
        if (!e.defaultPrevented) setOn(!on);
      }}
      style={{ width: 32, height: 18 }}
      className={clsx(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
        on ? 'bg-primary' : 'bg-neutral-hover',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={clsx('absolute rounded-full', on ? 'bg-fg-inverse' : 'bg-fg-subtle')}
        style={{
          width: 14,
          height: 14,
          top: 2,
          left: 2,
          transform: on ? 'translateX(14px)' : 'translateX(0)',
          transition: 'transform var(--ds-duration-100) ease-out',
        }}
      />
    </button>
  );
  if (label === undefined) return control;
  return (
    <label htmlFor={buttonId} className="inline-flex items-center gap-2 text-base text-fg">
      {control}
      {label}
    </label>
  );
});
