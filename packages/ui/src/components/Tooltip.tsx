import { cloneElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, MouseEvent, ReactElement, Ref } from 'react';
import clsx from 'clsx';
import { Portal } from './Portal';
import { usePopoverPosition } from './Popover';
import type { Placement } from './Popover';
import { mergeRefs } from '../utils/react';

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
  /** A single element that can hold a ref and receive DOM event props. */
  children: ReactElement<TooltipChildProps>;
  /** Show delay in ms (SPEC §4.9.10: 300). */
  delay?: number;
  placement?: Placement;
  disabled?: boolean;
}

/** Tooltip: 300ms delay, 12px text, max-width 240px, linked via aria-describedby. Esc/blur dismiss. */
export function Tooltip({ content, children, delay = 300, placement = 'top', disabled }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clear = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const show = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [clear, delay]);
  const hide = useCallback(() => {
    clear();
    setOpen(false);
  }, [clear]);

  useEffect(() => clear, [clear]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, hide]);

  const childProps = children.props;
  const childRef = (children as ReactElement & { ref?: Ref<HTMLElement> }).ref;
  const visible = open && !disabled;

  const trigger = cloneElement(children, {
    ref: mergeRefs<HTMLElement>(childRef, setAnchor),
    'aria-describedby': visible ? id : childProps['aria-describedby'],
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      childProps.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      childProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(e);
      show();
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(e);
      hide();
    },
    onMouseDown: (e: MouseEvent<HTMLElement>) => {
      childProps.onMouseDown?.(e);
      hide();
    },
  } as Partial<TooltipChildProps> & { ref: Ref<HTMLElement> });

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
  const pos = usePopoverPosition(anchor, true, { placement, offset: 6 });
  return (
    <div
      id={id}
      role="tooltip"
      ref={pos.floatingRef}
      className={clsx('pointer-events-none max-w-60 rounded-sm border border-border bg-overlay px-2 py-1 text-sm text-fg')}
      style={{ ...pos.style, zIndex: 'var(--ds-z-index-tooltip)' }}
    >
      {children}
    </div>
  );
}
