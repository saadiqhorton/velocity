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

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Live `prefers-reduced-motion: reduce` flag. False where matchMedia is unavailable (SSR, jsdom). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(REDUCED_MOTION_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Enter animations last at most 200ms (SPEC §4.8); after that the element is 'open'. */
const PRESENCE_ENTER_MS = 200;
/** Exit animations run 120ms with an accelerating ease (A2 motion). */
const PRESENCE_EXIT_MS = 120;

export type PresenceState = 'enter' | 'open' | 'exit';

/**
 * Keeps an element mounted through its exit animation. Render while `mounted`; use `state` to
 * pick the enter/exit class. `state` reads 'exit' whenever the element is closing or closed.
 * Under prefers-reduced-motion the exit collapses to an immediate unmount.
 */
export function usePresence(open: boolean, opts?: { exitMs?: number }): { mounted: boolean; state: PresenceState } {
  const exitMs = opts?.exitMs ?? PRESENCE_EXIT_MS;
  const reduced = usePrefersReducedMotion();
  const [presence, setPresence] = useState<{ mounted: boolean; state: PresenceState }>({
    mounted: open,
    state: open ? (reduced ? 'open' : 'enter') : 'exit',
  });
  const [prevOpen, setPrevOpen] = useState(open);
  // Adjust state during render when `open` flips (no extra commit with stale values).
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setPresence({ mounted: true, state: reduced ? 'open' : 'enter' });
    else setPresence({ mounted: !(reduced || exitMs <= 0), state: 'exit' });
  }
  const { mounted, state } = presence;
  useEffect(() => {
    // A timer can fire after `open` flipped but before this cleanup runs, so each one only
    // advances the state it was scheduled for; otherwise a late enter timer overwrites 'exit'
    // and the element never unmounts.
    if (state === 'enter') {
      const id = setTimeout(() => setPresence((p) => (p.state === 'enter' ? { ...p, state: 'open' } : p)), PRESENCE_ENTER_MS);
      return () => clearTimeout(id);
    }
    if (state === 'exit' && mounted) {
      const id = setTimeout(() => setPresence((p) => (p.state === 'exit' ? { ...p, mounted: false } : p)), exitMs);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [state, mounted, exitMs]);
  return presence;
}
