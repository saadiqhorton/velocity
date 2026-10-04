import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import { Portal } from './Portal';
import { useEnterStyle, useIsomorphicLayoutEffect } from '../utils/react';

export type Placement =
  | 'bottom-start'
  | 'bottom-end'
  | 'top-start'
  | 'top-end'
  | 'top'
  | 'bottom'
  | 'right-start'
  | 'left-start';

export interface PopoverPositionOptions {
  placement?: Placement;
  /** Gap between anchor and floating element in px. */
  offset?: number;
  /** Viewport padding in px. */
  padding?: number;
  /** Floating min-width follows anchor width. */
  matchWidth?: boolean;
}

export interface PopoverPosition {
  /** Pass to the floating element's `ref` (a callback ref). */
  setFloating: (el: HTMLElement | null) => void;
  style: CSSProperties;
  /** Placement after flipping. */
  placement: Placement;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function computePosition(
  anchor: Box,
  floating: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: Placement,
  offset: number,
  padding: number,
): { top: number; left: number; placement: Placement } {
  const [side, align = 'center'] = placement.split('-') as ['top' | 'bottom' | 'left' | 'right', string?];
  let finalSide = side;
  const aBottom = anchor.top + anchor.height;
  const aRight = anchor.left + anchor.width;
  let top: number;
  let left: number;

  if (side === 'top' || side === 'bottom') {
    const spaceBelow = viewport.height - aBottom - offset;
    const spaceAbove = anchor.top - offset;
    if (side === 'bottom' && floating.height > spaceBelow && spaceAbove > spaceBelow) finalSide = 'top';
    if (side === 'top' && floating.height > spaceAbove && spaceBelow > spaceAbove) finalSide = 'bottom';
    top = finalSide === 'bottom' ? aBottom + offset : anchor.top - offset - floating.height;
    if (align === 'start') left = anchor.left;
    else if (align === 'end') left = aRight - floating.width;
    else left = anchor.left + anchor.width / 2 - floating.width / 2;
  } else {
    const spaceRight = viewport.width - aRight - offset;
    const spaceLeft = anchor.left - offset;
    if (side === 'right' && floating.width > spaceRight && spaceLeft > spaceRight) finalSide = 'left';
    if (side === 'left' && floating.width > spaceLeft && spaceRight > spaceLeft) finalSide = 'right';
    left = finalSide === 'right' ? aRight + offset : anchor.left - offset - floating.width;
    top = anchor.top;
  }

  // shift into the viewport
  const maxLeft = viewport.width - floating.width - padding;
  const maxTop = viewport.height - floating.height - padding;
  left = Math.max(padding, Math.min(left, Math.max(padding, maxLeft)));
  top = Math.max(padding, Math.min(top, Math.max(padding, maxTop)));

  const flipped = finalSide === side ? placement : (placement.replace(side, finalSide) as Placement);
  return { top, left, placement: flipped };
}

/**
 * Small positioning hook (flip + shift) for popups anchored to an element.
 * Uses `position: fixed` so the popup can live in a portal.
 */
export function usePopoverPosition(
  anchorEl: HTMLElement | null,
  open: boolean,
  options: PopoverPositionOptions = {},
): PopoverPosition {
  const { placement = 'bottom-start', offset = 4, padding = 8, matchWidth = false } = options;
  const [floating, setFloating] = useState<HTMLElement | null>(null);
  const [state, setState] = useState<{ top: number; left: number; placement: Placement; ready: boolean; minWidth?: number }>({
    top: 0,
    left: 0,
    placement,
    ready: false,
  });

  const update = useCallback(() => {
    if (!anchorEl || !floating) return;
    const a = anchorEl.getBoundingClientRect();
    const f = floating.getBoundingClientRect();
    const result = computePosition(
      { top: a.top, left: a.left, width: a.width, height: a.height },
      { width: f.width, height: f.height },
      { width: window.innerWidth, height: window.innerHeight },
      placement,
      offset,
      padding,
    );
    setState((prev) =>
      prev.ready &&
      prev.top === result.top &&
      prev.left === result.left &&
      prev.placement === result.placement &&
      prev.minWidth === (matchWidth ? a.width : undefined)
        ? prev
        : { ...result, ready: true, minWidth: matchWidth ? a.width : undefined },
    );
  }, [anchorEl, floating, placement, offset, padding, matchWidth]);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    update();
  }, [open, update]);

  useEffect(() => {
    if (!open || !anchorEl || !floating) return;
    const onChange = () => update();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onChange);
      ro.observe(floating);
      ro.observe(anchorEl);
    }
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
      ro?.disconnect();
    };
  }, [open, anchorEl, floating, update]);

  const style: CSSProperties = {
    position: 'fixed',
    top: state.top,
    left: state.left,
    minWidth: state.minWidth,
  };
  return { setFloating, style, placement: state.placement };
}

export interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  anchorEl: HTMLElement | null;
  open: boolean;
  /** Called on a mousedown outside the popover and its anchor. */
  onDismiss?: () => void;
  placement?: Placement;
  offset?: number;
  matchWidth?: boolean;
  /** Skip the surface chrome (border, background, shadow). */
  bare?: boolean;
  children: ReactNode;
}

/** Positioned, portaled surface for dropdowns, pickers and popovers. */
export function Popover({
  anchorEl,
  open,
  onDismiss,
  placement,
  offset,
  matchWidth,
  bare,
  className,
  style,
  children,
  onMouseDown,
  ...rest
}: PopoverProps) {
  if (!open) return null;
  return (
    <Portal>
      <PopoverSurface
        anchorEl={anchorEl}
        onDismiss={onDismiss}
        placement={placement}
        offset={offset}
        matchWidth={matchWidth}
        bare={bare}
        className={className}
        style={style}
        onMouseDown={onMouseDown}
        {...rest}
      >
        {children}
      </PopoverSurface>
    </Portal>
  );
}

function PopoverSurface({
  anchorEl,
  onDismiss,
  placement,
  offset,
  matchWidth,
  bare,
  className,
  style,
  children,
  onMouseDown,
  ...rest
}: Omit<PopoverProps, 'open'>) {
  const pos = usePopoverPosition(anchorEl, true, { placement, offset, matchWidth });
  const enter = useEnterStyle();
  const elRef = useRef<HTMLDivElement | null>(null);
  const insideRef = useRef(false);
  const dismissRef = useRef(onDismiss);
  useIsomorphicLayoutEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // React synthetic mousedown bubbles through portals; it flags nested popups as "inside".
      if (insideRef.current) {
        insideRef.current = false;
        return;
      }
      const target = e.target as Node | null;
      if (target && (elRef.current?.contains(target) || anchorEl?.contains(target))) return;
      dismissRef.current?.();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [anchorEl]);

  return (
    <div
      {...rest}
      ref={(el) => {
        elRef.current = el;
        pos.setFloating(el);
      }}
      onMouseDown={(e) => {
        insideRef.current = true;
        onMouseDown?.(e);
      }}
      className={clsx(!bare && 'bg-overlay border border-border rounded-md shadow-overlay text-fg', className)}
      style={{ ...pos.style, zIndex: 'var(--ds-z-index-dropdown)', ...enter, ...style }}
    >
      {children}
    </div>
  );
}
