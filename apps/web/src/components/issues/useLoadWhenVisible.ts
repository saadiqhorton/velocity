import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Calls `onVisible` while the element is on screen. The observer is re-armed whenever `progress`
 * changes (e.g. the loaded count), so a placeholder that is still visible after a page arrives
 * asks for the next one; once it scrolls away or unmounts, loading stops.
 */
export function useLoadWhenVisible(ref: RefObject<Element | null>, enabled: boolean, onVisible: () => void, progress: number): void {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onVisible();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, enabled, onVisible, progress]);
}
