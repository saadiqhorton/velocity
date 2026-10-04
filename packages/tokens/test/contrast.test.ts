import { describe, expect, it } from 'vitest';
import { themes } from '../src/css';
import { statusPalette, chartPalette } from '../src/palette';
import { STATUS_COLORS, COLOR_ROLES } from '../src/types';
import type { ThemeName } from '../src/types';

type RGB = [number, number, number];
function parse(hex: string): { rgb: RGB; a: number } {
  const h = hex.replace('#', '');
  const rgb: RGB = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { rgb, a };
}
/** Composite a (possibly translucent) color over an opaque background. */
function over(fg: string, bg: string): RGB {
  const f = parse(fg);
  const b = parse(bg).rgb;
  return f.rgb.map((c, i) => Math.round(c * f.a + b[i]! * (1 - f.a))) as RGB;
}
function lum([r, g, b]: RGB): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function contrast(a: RGB, b: RGB): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}
function mix(color: string, bg: string, pct: number): RGB {
  const c = parse(color).rgb;
  const b = parse(bg).rgb;
  return c.map((v, i) => Math.round(v * pct + b[i]! * (1 - pct))) as RGB;
}

const NAMES: ThemeName[] = ['light', 'dark'];

describe.each(NAMES)('%s theme', (name) => {
  const c = themes[name].color as Record<string, string>;
  const surfaces = ['surface', 'surface-sunken', 'surface-raised'];

  it('defines every semantic role', () => {
    for (const role of COLOR_ROLES) expect(c[role], role).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/i);
  });

  it.each(['text', 'text-subtle', 'text-subtlest', 'link', 'danger-text', 'success-text', 'warning-text', 'discovery-text'])(
    '%s meets AA (4.5:1) on all surfaces',
    (role) => {
      for (const s of surfaces) {
        const ratio = contrast(over(c[role]!, c[s]!), parse(c[s]!).rgb);
        expect(ratio, `${role} on ${s} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('text-subtle meets AA on primary-subtle (selected rows)', () => {
    const bg = over(c['primary-subtle']!, c.surface!);
    const ratio = contrast(over(c['text-subtle']!, c.surface!), bg);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('primary button text (text-inverse on primary) meets AA', () => {
    expect(contrast(parse(c['text-inverse']!).rgb, parse(c.primary!).rgb)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([...STATUS_COLORS])('status %s lozenge text meets AA on its 15%% tint', (sc) => {
    const pair = statusPalette[name][sc];
    for (const s of ['surface', 'surface-raised']) {
      const bg = mix(pair.base, c[s]!, 0.15);
      const ratio = contrast(parse(pair.text).rgb, bg);
      expect(ratio, `${sc} on ${s} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('chart series colors meet 3:1 against the surface', () => {
    for (const col of chartPalette[name]) {
      expect(contrast(parse(col).rgb, parse(c.surface!).rgb), col).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('structural relationships (SPEC §4.3)', () => {
  it('dark: sunken < surface < raised in luminance', () => {
    const d = themes.dark.color as Record<string, string>;
    const l = (k: string) => lum(parse(d[k]!).rgb);
    expect(l('surface-sunken')).toBeLessThan(l('surface'));
    expect(l('surface')).toBeLessThan(l('surface-raised'));
  });
  it('light: binding spec values', () => {
    const l = themes.light.color as Record<string, string>;
    expect(l.primary).toBe('#0C66E4');
    expect(l.text).toBe('#172B4D');
    expect(l['text-subtle']).toBe('#44546F');
    expect(l.surface).toBe('#FFFFFF');
    expect(l['surface-sunken']).toBe('#F7F8F9');
    expect(l['primary-subtle']).toBe('#E9F2FF');
    expect(l.focus).toBe('#85B8FF');
  });
});
