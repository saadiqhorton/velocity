import { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Button, FlagProvider, Tooltip, useFlags } from '../src';

function Trigger() {
  const { showFlag } = useFlags();
  return (
    <>
      <button onClick={() => showFlag({ title: 'Saved', severity: 'success' })}>ok</button>
      <button onClick={() => showFlag({ title: 'Failed', severity: 'error' })}>fail</button>
    </>
  );
}

describe('Flags', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows at most 3 flags', () => {
    render(
      <FlagProvider>
        <Trigger />
      </FlagProvider>,
    );
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('ok'));
    expect(screen.getAllByText('Saved')).toHaveLength(3);
  });

  it('auto-dismisses after 5s but keeps errors', () => {
    render(
      <FlagProvider>
        <Trigger />
      </FlagProvider>,
    );
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('fail'));
    expect(screen.getByText('Saved')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(screen.getByText('Saved')).toBeTruthy();
    // Auto-dismiss at 5s, then the 120ms slide-out before the stack removes it (each step in its own act so effects run).
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(screen.queryByText('Saved')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByText('Failed')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0] as HTMLElement);
    expect(screen.getByText('Failed')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(screen.queryByText('Failed')).toBeNull();
  });
});

describe('Flag stack', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Mounts a provider and returns `show(title, options)` for pushing flags from the test. */
  function renderStack() {
    const api: { showFlag?: ReturnType<typeof useFlags>['showFlag'] } = {};
    function Grab() {
      const { showFlag } = useFlags();
      useEffect(() => {
        api.showFlag = showFlag;
      }, [showFlag]);
      return null;
    }
    render(
      <FlagProvider>
        <Grab />
      </FlagProvider>,
    );
    return (title: string, options: { severity?: 'success' | 'error'; persistent?: boolean } = {}) =>
      act(() => {
        api.showFlag?.({ title, severity: 'success', ...options });
      });
  }

  it('shows the newest three flags, with the newest last (nearest the corner)', () => {
    const show = renderStack();
    for (const title of ['One', 'Two', 'Three', 'Four']) show(title);
    const stack = screen.getByLabelText('Notifications');
    expect(screen.queryByText('One')).toBeNull();
    expect(within(stack).getAllByText(/^(Two|Three|Four)$/).map((el) => el.textContent)).toEqual(['Two', 'Three', 'Four']);
  });

  it('a fourth flag is visible while an older persistent error is on screen', () => {
    const show = renderStack();
    show('Failed', { severity: 'error' });
    show('One');
    show('Two');
    show('Three');
    expect(screen.getByText('Three')).toBeTruthy();
    expect(screen.getByText('Two')).toBeTruthy();
    expect(screen.getByText('One')).toBeTruthy();
  });

  it('a transient flag pushed out of view does not come back when newer flags clear', () => {
    const show = renderStack();
    show('Early');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    show('B');
    show('C');
    show('D');
    expect(screen.queryByText('Early')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(screen.queryByText('Early')).toBeNull();
    expect(screen.queryByText('B')).toBeNull();
    expect(screen.queryByText('D')).toBeNull();
  });

  it('a visible flag keeps its own 5s timer when newer flags arrive', () => {
    const show = renderStack();
    show('A');
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    show('B');
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    // A is sliding out (its 5s ran out at 5000ms); it leaves the stack 120ms later.
    expect(screen.getByText('A').closest('[role="status"]')?.getAttribute('aria-hidden')).toBe('true');
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(screen.queryByText('A')).toBeNull();
    expect(screen.getByText('B')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(3900);
    });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(screen.queryByText('B')).toBeNull();
  });
});

describe('Tooltip', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('appears after 300ms and links via aria-describedby', () => {
    render(
      <Tooltip content="Copy link">
        <Button>Target</Button>
      </Tooltip>,
    );
    const target = screen.getByRole('button', { name: 'Target' });
    fireEvent.mouseEnter(target);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('Copy link');
    expect(target.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(target.getAttribute('aria-describedby')).toBeNull();
  });

  it('dismisses on blur', () => {
    render(
      <Tooltip content="Hint">
        <Button>Target</Button>
      </Tooltip>,
    );
    const target = screen.getByRole('button', { name: 'Target' });
    fireEvent.focus(target);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.blur(target);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
