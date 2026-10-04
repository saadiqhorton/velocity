import { createContext, useContext, useId } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';

export interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  /** Always-visible label (placeholder-only labels are banned). */
  label: ReactNode;
  /** Override the generated control id. */
  htmlFor?: string;
  helperText?: ReactNode;
  /** Inline error message; marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + helper/error wiring (htmlFor, aria-describedby, aria-invalid). */
export function Field({ label, htmlFor, helperText, error, required = false, className, children }: FieldProps) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, helperText ? helperId : null].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error), required }}>
      <div className={clsx('flex flex-col', className)}>
        <label htmlFor={id} className="mb-1 text-sm font-semibold text-fg-subtle">
          {label}
          {required ? (
            <span aria-hidden="true" className="ml-1 text-danger-fg">
              *
            </span>
          ) : null}
        </label>
        {children}
        {error ? (
          <p id={errorId} className="mt-1 text-sm text-danger-fg" aria-live="polite">
            {error}
          </p>
        ) : null}
        {helperText ? (
          <p id={helperId} className="mt-1 text-sm text-fg-subtle">
            {helperText}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export const controlClass =
  'w-full rounded-sm border bg-input px-2 text-base text-fg placeholder:text-fg-subtlest hover:bg-sunken focus:border-primary disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-disabled transition-colors duration-100';
