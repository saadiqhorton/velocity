import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FlagProvider, useFlags } from '../src';

function Trigger() {
  const { showFlag } = useFlags();
  return <button onClick={() => showFlag({ title: 'Saved', severity: 'success' })}>ok</button>;
}

/** Stub matchMedia so `(prefers-reduced-motion: reduce)` matches when `reduce` is true. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('Flag exit motion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('slides out for 120ms when dismissed, then leaves the stack', () => {
    render(
      <FlagProvider>
        <Trigger />
      </FlagProvider>,
    );
    fireEvent.click(screen.getByText('ok'));
    const toast = screen.getByRole('status');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(toast.isConnected).toBe(true);
    expect(toast.getAttribute('aria-hidden')).toBe('true');
    expect(toast.classList.contains('pointer-events-none')).toBe(true);
    expect(toast.style.opacity).toBe('0');

    act(() => vi.advanceTimersByTime(119));
    expect(toast.isConnected).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(toast.isConnected).toBe(false);
  });

  it('slides out on the 5s auto-dismiss too', () => {
    render(
      <FlagProvider>
        <Trigger />
      </FlagProvider>,
    );
    fireEvent.click(screen.getByText('ok'));
    const toast = screen.getByRole('status');
    act(() => vi.advanceTimersByTime(5000));
    expect(toast.getAttribute('aria-hidden')).toBe('true');
    act(() => vi.advanceTimersByTime(120));
    expect(toast.isConnected).toBe(false);
  });

  it('removes the toast immediately under prefers-reduced-motion', () => {
    stubReducedMotion(true);
    render(
      <FlagProvider>
        <Trigger />
      </FlagProvider>,
    );
    fireEvent.click(screen.getByText('ok'));
    const toast = screen.getByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(toast.isConnected).toBe(false);
  });
});

describe('Flag stack placement', () => {
  it('offsets past the sidebar only through --flag-inset-left (set by the app shell), not unconditionally', () => {
    render(
      <FlagProvider>
        <span />
      </FlagProvider>,
    );
    const stack = screen.getByLabelText('Notifications');
    expect(stack.className).toContain('md:left-[var(--flag-inset-left,1rem)]');
    expect(stack.className).not.toContain('calc(');
  });
});
