import { useCallback, useEffect, useRef, useState } from 'react';

/** Tracks an element's content width with a ResizeObserver (charts reflow to their card). */
export function useElementWidth<T extends HTMLElement>(fallback = 480): [(el: T | null) => void, number] {
  const [width, setWidth] = useState(fallback);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width) || fallback);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    observer.current = ro;
  }, [fallback]);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, width];
}

/** Round a maximum up to a "nice" axis bound with the given tick count. */
export function niceMax(max: number, ticks = 4): { max: number; step: number } {
  if (max <= 0) return { max: ticks, step: 1 };
  const rough = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / pow;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * pow;
  return { max: step * ticks, step };
}
