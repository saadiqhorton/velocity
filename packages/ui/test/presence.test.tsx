import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePresence } from '../src';

/** Stub matchMedia so `(prefers-reduced-motion: reduce)` matches when `reduce` is true. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('usePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('mounts on open in the enter state, then settles to open', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), { initialProps: { open: false } });
    expect(result.current).toEqual({ mounted: false, state: 'exit' });

    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, state: 'enter' });

    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toEqual({ mounted: true, state: 'open' });
  });

  it('stays mounted through the 120ms exit, then unmounts', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), { initialProps: { open: true } });
    act(() => vi.advanceTimersByTime(200));

    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, state: 'exit' });

    act(() => vi.advanceTimersByTime(119));
    expect(result.current.mounted).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ mounted: false, state: 'exit' });
  });

  it('honours a custom exitMs', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, { exitMs: 300 }), {
      initialProps: { open: true },
    });
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(299));
    expect(result.current.mounted).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.mounted).toBe(false);
  });

  it('cancels the pending unmount when reopened during the exit', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), { initialProps: { open: true } });
    act(() => vi.advanceTimersByTime(200));
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(60));
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, state: 'enter' });

    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toEqual({ mounted: true, state: 'open' });
  });

  it('unmounts immediately on close under prefers-reduced-motion', () => {
    stubReducedMotion(true);
    const { result, rerender } = renderHook(({ open }) => usePresence(open), { initialProps: { open: true } });
    expect(result.current).toEqual({ mounted: true, state: 'open' });

    rerender({ open: false });
    expect(result.current).toEqual({ mounted: false, state: 'exit' });
  });

  it('skips the enter state under prefers-reduced-motion', () => {
    stubReducedMotion(true);
    const { result, rerender } = renderHook(({ open }) => usePresence(open), { initialProps: { open: false } });
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, state: 'open' });
  });
});
