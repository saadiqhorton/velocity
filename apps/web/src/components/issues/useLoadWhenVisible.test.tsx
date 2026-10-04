import { useRef } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLoadWhenVisible } from './useLoadWhenVisible';

type Callback = (entries: { isIntersecting: boolean }[]) => void;
const observers: { cb: Callback; disconnected: boolean }[] = [];

class FakeObserver {
  private readonly rec: { cb: Callback; disconnected: boolean };
  constructor(cb: Callback) {
    this.rec = { cb, disconnected: false };
    observers.push(this.rec);
  }
  observe() {}
  disconnect() {
    this.rec.disconnected = true;
  }
}

function Placeholder({ enabled, onVisible, progress }: { enabled: boolean; onVisible: () => void; progress: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLoadWhenVisible(ref, enabled, onVisible, progress);
  return <div ref={ref}>Loading more issues</div>;
}

describe('useLoadWhenVisible (board columns past the eager cap)', () => {
  afterEach(() => {
    observers.length = 0;
    vi.unstubAllGlobals();
  });

  it('loads while the placeholder is visible and re-arms after every page', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const onVisible = vi.fn();
    const { rerender, unmount } = render(<Placeholder enabled onVisible={onVisible} progress={500} />);
    const live = () => observers.filter((o) => !o.disconnected);
    expect(live()).toHaveLength(1);
    live()[0]!.cb([{ isIntersecting: false }]);
    expect(onVisible).not.toHaveBeenCalled();
    live()[0]!.cb([{ isIntersecting: true }]);
    expect(onVisible).toHaveBeenCalledTimes(1);

    // A page arrived but the column still waits: a fresh observer asks again.
    rerender(<Placeholder enabled onVisible={onVisible} progress={900} />);
    expect(live()).toHaveLength(1);
    live()[0]!.cb([{ isIntersecting: true }]);
    expect(onVisible).toHaveBeenCalledTimes(2);

    // Everything for this column is loaded: no observer left.
    rerender(<Placeholder enabled={false} onVisible={onVisible} progress={1400} />);
    expect(live()).toHaveLength(0);
    unmount();
  });

  it('does nothing where IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onVisible = vi.fn();
    render(<Placeholder enabled onVisible={onVisible} progress={1} />);
    expect(onVisible).not.toHaveBeenCalled();
  });
});
