import { cloneElement, useCallback, useEffect, useId, useState } from 'react';
import type { FocusEvent, MouseEvent, ReactElement } from 'react';
import { Portal } from './Portal';
import { usePopoverPosition } from './Popover';
import type { Placement } from './Popover';

interface TooltipChildProps {
  onMouseEnter?: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onMouseDown?: (e: MouseEvent<HTMLElement>) => void;
  'aria-describedby'?: string;
}

export interface TooltipProps {
  content: string;
  /** A single element that receives DOM event props. Its own ref is left untouched. */
  children: ReactElement<TooltipChildProps>;
  /** Show delay in ms (SPEC §4.9.10: 300). */
  delay?: number;
  placement?: Placement;
  disabled?: boolean;
}

/**
 * Tooltip: 300ms delay, 12px text, max-width 240px, linked via aria-describedby. Esc/blur dismiss.
 * The anchor is captured from the hover/focus event target, so the child's ref is never read.
 */
export function Tooltip({ content, children, delay = 300, placement = 'top', disabled }: TooltipProps) {
  const id = useId();
  // `pending` arms the show delay; the effect owns the timer so no ref is touched during render.
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const show = useCallback((el: HTMLElement) => {
    setAnchor(el);
    setPending(true);
  }, []);
  const hide = useCallback(() => {
    setPending(false);
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setOpen(true), delay);
    return () => clearTimeout(t);
  }, [pending, delay]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, hide]);

  const childProps = children.props;
  const visible = open && !disabled && anchor !== null;

  const trigger = cloneElement(children, {
    'aria-describedby': visible ? id : childProps['aria-describedby'],
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      childProps.onMouseEnter?.(e);
      show(e.currentTarget);
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      childProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(e);
      show(e.currentTarget);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(e);
      hide();
    },
    onMouseDown: (e: MouseEvent<HTMLElement>) => {
      childProps.onMouseDown?.(e);
      hide();
    },
  } as Partial<TooltipChildProps>);

  return (
    <>
      {trigger}
      {visible ? (
        <Portal>
          <TooltipBubble id={id} anchor={anchor} placement={placement}>
            {content}
          </TooltipBubble>
        </Portal>
      ) : null}
    </>
  );
}

function TooltipBubble({
  id,
  anchor,
  placement,
  children,
}: {
  id: string;
  anchor: HTMLElement | null;
  placement: Placement;
  children: string;
}) {
  const { setFloating, style } = usePopoverPosition(anchor, true, { placement, offset: 6 });
  return (
    <div
      id={id}
      role="tooltip"
      ref={setFloating}
      className="pointer-events-none max-w-60 rounded-sm bg-fg px-2 py-1 text-sm text-fg-inverse"
      style={{ ...style, zIndex: 'var(--ds-z-index-tooltip)' }}
    >
      {children}
    </div>
  );
}
