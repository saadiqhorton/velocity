import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DropdownMenu, MenuItem, Popover, SubMenu } from '../src';

/** Stub matchMedia so `(prefers-reduced-motion: reduce)` matches when `reduce` is true. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function ToggledPopover({ onDismiss }: { onDismiss?: () => void }) {
  const [open, setOpen] = useState(true);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={setAnchor} onClick={() => setOpen((o) => !o)}>
        toggle
      </button>
      <Popover
        anchorEl={anchor}
        open={open}
        onDismiss={() => {
          onDismiss?.();
          setOpen(false);
        }}
      >
        <p>Body</p>
      </Popover>
    </>
  );
}

describe('Popover exit motion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stays mounted with the exit class for 120ms, then unmounts', () => {
    render(<ToggledPopover />);
    const body = screen.getByText('Body');
    const surface = body.parentElement as HTMLElement;
    expect(surface.classList.contains('ds-pop-out')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(body.isConnected).toBe(true);
    expect(surface.classList.contains('ds-pop-out')).toBe(true);

    act(() => vi.advanceTimersByTime(119));
    expect(body.isConnected).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(body.isConnected).toBe(false);
  });

  it('is inert while it exits: aria-hidden, pointer-events off, and no outside-click dismiss', () => {
    const onDismiss = vi.fn();
    render(<ToggledPopover onDismiss={onDismiss} />);
    const surface = screen.getByText('Body').parentElement as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));

    expect(surface.getAttribute('aria-hidden')).toBe('true');
    expect(surface.classList.contains('pointer-events-none')).toBe(true);
    fireEvent.mouseDown(document.body);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('unmounts immediately on close under prefers-reduced-motion', () => {
    stubReducedMotion(true);
    render(<ToggledPopover />);
    const body = screen.getByText('Body');
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(body.isConnected).toBe(false);
  });
});

describe('Menu exit motion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns focus to the trigger at once, while the menu is still fading out', () => {
    render(
      <DropdownMenu trigger={<button>Actions</button>}>
        <MenuItem>Edit</MenuItem>
      </DropdownMenu>,
    );
    const trigger = screen.getByText('Actions');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    // Still mounted (exiting), but hidden from assistive tech and out of the pointer path.
    const surface = screen.getByRole('menu', { hidden: true }).parentElement as HTMLElement;
    expect(surface.classList.contains('ds-pop-out')).toBe(true);
    expect(surface.getAttribute('aria-hidden')).toBe('true');

    act(() => vi.advanceTimersByTime(120));
    expect(screen.queryByRole('menu', { hidden: true })).toBeNull();
  });

  it('fades a submenu out the same way when it closes', () => {
    render(
      <DropdownMenu trigger={<button>Actions</button>}>
        <SubMenu label="Move to">
          <MenuItem>Engineering</MenuItem>
        </SubMenu>
      </DropdownMenu>,
    );
    const trigger = screen.getByText('Actions');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const sub = screen.getByRole('menuitem', { name: 'Move to' });
    fireEvent.keyDown(sub, { key: 'ArrowRight' });
    expect(screen.getAllByRole('menu')).toHaveLength(2);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(sub);
    const submenu = screen.getAllByRole('menu', { hidden: true }).find((el) => el.getAttribute('aria-label') === 'Move to');
    expect(submenu?.parentElement?.classList.contains('ds-pop-out')).toBe(true);

    act(() => vi.advanceTimersByTime(120));
    expect(screen.getAllByRole('menu', { hidden: true })).toHaveLength(1);
  });
});
