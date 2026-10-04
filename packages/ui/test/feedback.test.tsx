import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('Saved')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByText('Failed')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0] as HTMLElement);
    expect(screen.queryByText('Failed')).toBeNull();
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
