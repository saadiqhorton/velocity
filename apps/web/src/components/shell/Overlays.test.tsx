import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useUi } from '@/stores/ui';
import { Overlays } from './Overlays';

const mounts = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/components/palette/CommandPalette', () => ({
  CommandPalette: ({ state }: { state: string }) => {
    const [mount] = useState(() => ++mounts.count);
    return <div data-testid="palette" data-state={state} data-mount={mount} />;
  },
}));
vi.mock('@/components/overlays/PickerHost', () => ({ PickerHost: () => null }));
vi.mock('@/components/overlays/SelectionBar', () => ({ SelectionBar: () => null }));
vi.mock('@/components/overlays/DeleteConfirmHost', () => ({ DeleteConfirmHost: () => null }));
vi.mock('@/components/overlays/IssueContextMenu', () => ({ IssueContextMenu: () => null }));

/** Stub matchMedia so `(prefers-reduced-motion: reduce)` matches when `reduce` is true. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('Overlays: command palette presence', () => {
  beforeEach(() => {
    stubReducedMotion(false);
    mounts.count = 0;
    act(() => useUi.setState({ paletteOpen: false }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the palette mounted through a 120ms exit, then unmounts it', async () => {
    render(<Overlays />);
    expect(screen.queryByTestId('palette')).toBeNull();

    act(() => useUi.setState({ paletteOpen: true }));
    await waitFor(() => expect(screen.getByTestId('palette').getAttribute('data-state')).toBe('enter'));
    vi.useFakeTimers();

    act(() => useUi.setState({ paletteOpen: false }));
    expect(screen.getByTestId('palette').getAttribute('data-state')).toBe('exit');

    act(() => vi.advanceTimersByTime(119));
    expect(screen.getByTestId('palette')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('palette')).toBeNull();
  });

  it('starts a fresh palette when reopened during the exit', async () => {
    render(<Overlays />);
    act(() => useUi.setState({ paletteOpen: true }));
    await waitFor(() => expect(screen.getByTestId('palette')).toBeTruthy());
    vi.useFakeTimers();
    const first = screen.getByTestId('palette').getAttribute('data-mount');

    act(() => useUi.setState({ paletteOpen: false }));
    act(() => vi.advanceTimersByTime(60));
    act(() => useUi.setState({ paletteOpen: true }));

    const reopened = screen.getByTestId('palette');
    expect(reopened.getAttribute('data-mount')).not.toBe(first);
    expect(reopened.getAttribute('data-state')).toBe('enter');
  });

  it('unmounts at once under prefers-reduced-motion', async () => {
    stubReducedMotion(true);
    render(<Overlays />);
    act(() => useUi.setState({ paletteOpen: true }));
    await waitFor(() => expect(screen.getByTestId('palette')).toBeTruthy());
    act(() => useUi.setState({ paletteOpen: false }));
    expect(screen.queryByTestId('palette')).toBeNull();
  });
});
