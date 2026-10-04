import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'default' | 'subtle' | 'link' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export const buttonVariantClass: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-fg-inverse hover:bg-primary-hover disabled:bg-neutral disabled:text-fg-disabled',
  default:
    'border border-border-input bg-transparent text-fg hover:bg-hover active:bg-pressed disabled:text-fg-disabled disabled:border-border',
  subtle: 'bg-transparent text-fg-subtle hover:bg-hover hover:text-fg active:bg-pressed disabled:text-fg-disabled',
  link: 'bg-transparent text-link hover:underline disabled:text-fg-disabled disabled:no-underline',
  danger: 'bg-danger text-fg-inverse hover:bg-danger-fg disabled:bg-neutral disabled:text-fg-disabled',
};

export const buttonSizeClass: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-sm',
  md: 'h-8 px-3 text-base',
  lg: 'h-10 px-4 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner while keeping the button's width; click is blocked. */
  loading?: boolean;
  iconBefore?: ReactNode;
  iconAfter?: ReactNode;
  fullWidth?: boolean;
  /** Square icon-only sizing (used by IconButton). */
  square?: boolean;
}

const squareSizeClass: Record<ButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    loading = false,
    iconBefore,
    iconAfter,
    fullWidth,
    square,
    disabled,
    className,
    children,
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  const isLink = variant === 'link';
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={clsx(
        'relative inline-flex select-none items-center justify-center gap-1 whitespace-nowrap rounded-sm font-medium transition-colors duration-100 disabled:cursor-not-allowed',
        isLink ? 'h-auto px-0' : square ? squareSizeClass[size] : buttonSizeClass[size],
        buttonVariantClass[variant],
        fullWidth && 'w-full',
        className,
      )}
    >
      <span className={clsx('inline-flex items-center justify-center gap-1', loading && 'invisible')}>
        {iconBefore}
        {children}
        {iconAfter}
      </span>
      {loading ? (
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <Spinner label="Loading" />
        </span>
      ) : null}
    </button>
  );
});

type IconButtonOwnProps = Omit<ButtonProps, 'children' | 'iconBefore' | 'iconAfter' | 'aria-label' | 'fullWidth' | 'square'>;

export interface IconButtonProps extends IconButtonOwnProps {
  /** Required: becomes the aria-label and the tooltip text. */
  label: string;
  icon: ReactNode;
  'aria-label'?: never;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'subtle', size = 'md', className, ...rest },
  ref,
) {
  return (
    <Tooltip content={label}>
      <Button
        {...rest}
        ref={ref}
        variant={variant}
        size={size}
        aria-label={label}
        square
        className={className}
      >
        {icon}
      </Button>
    </Tooltip>
  );
});
