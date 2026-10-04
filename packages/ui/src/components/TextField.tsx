import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Field, controlClass, useFieldContext } from './Field';

export type TextFieldSize = 'sm' | 'md';

interface WrapperProps {
  label?: ReactNode;
  helperText?: ReactNode;
  error?: ReactNode;
  invalid?: boolean;
  size?: TextFieldSize;
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, WrapperProps {}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(props, ref) {
  const { label, helperText, error, invalid, size = 'md', className, id, required, ...rest } = props;
  const ctx = useFieldContext();
  const wrap = label !== undefined;
  const input = (
    <InputControl
      {...rest}
      ref={ref}
      size={size}
      invalid={Boolean(invalid || error)}
      className={className}
      id={id}
      required={required}
    />
  );
  if (wrap) {
    return (
      <Field label={label} htmlFor={id} helperText={helperText} error={error} required={required}>
        {input}
      </Field>
    );
  }
  if (!ctx && (helperText || error)) {
    return (
      <div className="flex flex-col">
        {input}
        {error ? <p className="mt-1 text-sm text-danger-fg">{error}</p> : null}
        {helperText ? <p className="mt-1 text-sm text-fg-subtle">{helperText}</p> : null}
      </div>
    );
  }
  return input;
});

interface InputControlProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size: TextFieldSize;
  invalid: boolean;
}

const InputControl = forwardRef<HTMLInputElement, InputControlProps>(function InputControl(
  { size, invalid, className, ...rest },
  ref,
) {
  const ctx = useFieldContext();
  const isInvalid = invalid || Boolean(ctx?.invalid);
  return (
    <input
      {...rest}
      ref={ref}
      id={rest.id ?? ctx?.id}
      required={rest.required ?? ctx?.required}
      aria-describedby={rest['aria-describedby'] ?? ctx?.describedBy}
      aria-invalid={isInvalid || undefined}
      className={clsx(controlClass, size === 'sm' ? 'h-7' : 'h-8', isInvalid ? 'border-danger' : 'border-border-input', className)}
    />
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, WrapperProps {}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(props, ref) {
  const { label, helperText, error, invalid, size = 'md', className, id, required, rows = 3, ...rest } = props;
  const ctx = useFieldContext();
  const isInvalid = Boolean(invalid || error || ctx?.invalid);
  const area = (
    <textarea
      {...rest}
      ref={ref}
      rows={rows}
      id={id ?? ctx?.id}
      required={required ?? ctx?.required}
      aria-describedby={rest['aria-describedby'] ?? ctx?.describedBy}
      aria-invalid={isInvalid || undefined}
      className={clsx(
        controlClass,
        'resize-y py-1',
        size === 'sm' ? 'min-h-7' : 'min-h-8',
        isInvalid ? 'border-danger' : 'border-border-input',
        className,
      )}
    />
  );
  if (label !== undefined) {
    return (
      <Field label={label} htmlFor={id} helperText={helperText} error={error} required={required}>
        {area}
      </Field>
    );
  }
  return area;
});
