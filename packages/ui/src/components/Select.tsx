import { forwardRef } from 'react';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Field, controlClass, useFieldContext } from './Field';
import { Icon } from './Icon';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Native select: use for 15 or fewer static options; use PopupSelect otherwise. */
  options: SelectOption[];
  size?: 'sm' | 'md';
  invalid?: boolean;
  label?: ReactNode;
  helperText?: ReactNode;
  error?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, size = 'md', invalid, label, helperText, error, className, id, required, ...rest },
  ref,
) {
  const ctx = useFieldContext();
  const isInvalid = Boolean(invalid || error || ctx?.invalid);
  const control = (
    <span className="relative inline-flex w-full items-center">
      <select
        {...rest}
        ref={ref}
        id={id ?? ctx?.id}
        required={required ?? ctx?.required}
        aria-describedby={rest['aria-describedby'] ?? ctx?.describedBy}
        aria-invalid={isInvalid || undefined}
        className={clsx(
          controlClass,
          'appearance-none pr-8',
          size === 'sm' ? 'h-7' : 'h-8',
          isInvalid ? 'border-danger' : 'border-border-input',
          className,
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" className="pointer-events-none absolute right-2 text-fg-subtle" />
    </span>
  );
  if (label !== undefined) {
    return (
      <Field label={label} htmlFor={id} helperText={helperText} error={error} required={required}>
        {control}
      </Field>
    );
  }
  return control;
});
