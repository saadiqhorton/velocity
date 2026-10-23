import { describe, expect, it } from 'vitest';
import { buildTokensCss } from '../src/css';
import { easing } from '../src/scales';

describe('motion tokens', () => {
  const css = buildTokensCss();

  it('emits the easing curves as --ds-ease-* variables', () => {
    expect(css).toContain('--ds-ease-enter: cubic-bezier(0.16, 1, 0.3, 1);');
    expect(css).toContain('--ds-ease-exit: cubic-bezier(0.4, 0, 1, 1);');
    expect(css).toContain('--ds-ease-standard: cubic-bezier(0.2, 0, 0, 1);');
  });

  it('uses control points inside [0, 1] on y so nothing overshoots (no bounce)', () => {
    for (const curve of Object.values(easing)) {
      const [, y1, , y2] = curve.replace(/cubic-bezier\(|\)/g, '').split(',').map(Number);
      for (const y of [y1, y2]) expect(y).toBeGreaterThanOrEqual(0);
      for (const y of [y1, y2]) expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('still zeroes the duration tokens under prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{\s*--ds-duration-100: 0ms;/);
  });
});
