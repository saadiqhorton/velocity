import { createContext, forwardRef, useContext, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import { useControllableState } from '../utils/react';

interface RadioGroupContextValue {
  name: string;
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
}
const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps {
  /** Accessible name for the group. */
  label: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
  /** Keep to 5 options or fewer; use Select beyond that. */
  children: ReactNode;
}

export function RadioGroup({
  label,
  value,
  defaultValue,
  onChange,
  name,
  disabled,
  orientation = 'vertical',
  className,
  children,
}: RadioGroupProps) {
  const generated = useId();
  const [current, setCurrent] = useControllableState<string | undefined>(value, defaultValue, onChange as ((v: string | undefined) => void) | undefined);
  return (
    <RadioGroupContext.Provider
      value={{ name: name ?? generated, value: current, onChange: (v) => setCurrent(v), disabled }}
    >
      <div
        role="radiogroup"
        aria-label={label}
        className={clsx('flex gap-2', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap', className)}
      >
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> {
  value: string;
  label: ReactNode;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { value, label, className, disabled, onChange, ...rest },
  ref,
) {
  const group = useContext(RadioGroupContext);
  const id = useId();
  return (
    <label htmlFor={id} className={clsx('inline-flex items-center gap-2 text-base text-fg', (disabled || group?.disabled) && 'text-fg-disabled')}>
      <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          {...rest}
          id={id}
          ref={ref}
          type="radio"
          name={group?.name ?? rest.name}
          value={value}
          disabled={disabled || group?.disabled}
          checked={group ? group.value === value : rest.checked}
          onChange={(e) => {
            onChange?.(e);
            group?.onChange(value);
          }}
          className={clsx(
            'peer h-4 w-4 cursor-pointer appearance-none rounded-full border border-border-input bg-input transition-colors duration-100',
            'checked:border-primary disabled:cursor-not-allowed disabled:bg-sunken disabled:border-border',
            className,
          )}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute hidden h-2 w-2 rounded-full bg-primary peer-checked:block"
        />
      </span>
      {label}
    </label>
  );
});
