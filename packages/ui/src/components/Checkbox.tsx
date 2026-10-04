import { forwardRef, useEffect, useId, useRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import { mergeRefs } from '../utils/react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode;
  /** Mixed state for bulk-selection headers. */
  indeterminate?: boolean;
}

/** 16px checkbox with indeterminate support. Provide `label` or `aria-label`. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, indeterminate = false, className, id, disabled, ...rest },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const innerRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const box = (
    <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
      <input
        {...rest}
        id={inputId}
        ref={mergeRefs(innerRef, ref)}
        type="checkbox"
        disabled={disabled}
        aria-checked={indeterminate ? 'mixed' : undefined}
        className={clsx(
          'peer h-4 w-4 cursor-pointer appearance-none rounded-sm border border-border-input bg-input transition-colors duration-100',
          'checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary',
          'disabled:cursor-not-allowed disabled:border-border disabled:bg-sunken',
          className,
        )}
      />
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden text-fg-inverse peer-checked:block peer-indeterminate:hidden"
      >
        <path d="M4.5 8.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden text-fg-inverse peer-indeterminate:block"
      >
        <path d="M4.5 8h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
  if (label === undefined) return box;
  return (
    <label htmlFor={inputId} className={clsx('inline-flex items-center gap-2 text-base text-fg', disabled && 'text-fg-disabled')}>
      {box}
      {label}
    </label>
  );
});
