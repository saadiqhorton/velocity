import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MutableRefObject, Ref, RefCallback } from 'react';

/** useLayoutEffect that does not warn during SSR. */
export const useIsomorphicLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

export function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as MutableRefObject<T | null>).current = value;
}

export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (value) => {
    for (const ref of refs) assignRef(ref, value);
  };
}

/** Controlled / uncontrolled state helper. */
export function useControllableState<T>(
  controlled: T | undefined,
  defaultValue: T,
  onChange?: (value: T) => void,
): [T, (value: T) => void] {
  const [inner, setInner] = useState<T>(defaultValue);
  const isControlled = controlled !== undefined;
  const value = isControlled ? controlled : inner;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  const set = useCallback(
    (next: T) => {
      if (Object.is(next, valueRef.current)) return;
      if (!isControlled) setInner(next);
      onChangeRef.current?.(next);
    },
    [isControlled],
  );
  return [value, set];
}

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/** Transition style for the allowed enter motion: 150ms opacity + 4px translate (SPEC §4.8). */
export function useEnterStyle(options?: {
  durationVar?: string;
  from?: string;
  /** which axis to slide on */
}): { opacity: number; transform: string; transition: string } {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const duration = options?.durationVar ?? 'var(--ds-duration-150)';
  const from = options?.from ?? 'translateY(4px)';
  return {
    opacity: on ? 1 : 0,
    transform: on ? 'translateY(0)' : from,
    transition: `opacity ${duration} ease-out, transform ${duration} ease-out`,
  };
}
