import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Icon, iconMap } from '../src';
import type { IconName } from '../src';
import { solidIconNames } from '../src/icons';

const names = Object.keys(iconMap) as IconName[];

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('Icon rendered no <svg>');
  return svg;
}

describe('Icon glyphs (SPEC 4.7 stroke/currentColor)', () => {
  it.each(names)('renders %s as a stroke glyph with no solid area', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = svgOf(container);
    expect(svg.children.length).toBeGreaterThan(0);
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe(solidIconNames.has(name) ? 'currentColor' : 'none');
    expect(svg.getAttribute('data-icon')).toBe(name);
    // Lucide's 0.5-unit "eye" dots (tag, tags, key-round) are the only filled shapes allowed.
    const solidShapes = Array.from(svg.querySelectorAll('[fill]:not([fill="none"])')).filter(
      (el) => !(el.tagName === 'circle' && Number(el.getAttribute('r')) <= 0.5),
    );
    if (!solidIconNames.has(name)) expect(solidShapes).toEqual([]);
  });

  it.each([16, 20, 24] as const)('keeps a 1.5px stroke at %dpx', (size) => {
    const { container } = render(<Icon name="search" size={size} />);
    const svg = svgOf(container);
    expect(svg.getAttribute('width')).toBe(String(size));
    // absoluteStrokeWidth rescales the 24-unit viewBox so the rendered stroke is 1.5px at any size.
    const renderedPx = (Number(svg.getAttribute('stroke-width')) * size) / 24;
    expect(renderedPx).toBeCloseTo(1.5);
  });

  it('keeps the layout classes and merges caller classes', () => {
    const { container } = render(<Icon name="inbox" className="text-fg" />);
    const className = svgOf(container).getAttribute('class') ?? '';
    expect(className).toContain('shrink-0 inline-block');
    expect(className).toContain('text-fg');
  });

  it('exposes a label as an image with an accessible name', () => {
    const { container } = render(<Icon name="inbox" label="Inbox" />);
    const svg = screen.getByRole('img', { name: 'Inbox' });
    expect(svg).toBe(svgOf(container));
    expect(svg.getAttribute('aria-hidden')).toBeNull();
    expect(svg.getAttribute('focusable')).toBe('false');
  });

  it('hides decorative icons from assistive technology', () => {
    const { container } = render(<Icon name="inbox" />);
    const svg = svgOf(container);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('fills state glyphs by default and lets callers force the fill', () => {
    const solid = render(<Icon name="star-filled" />);
    expect(svgOf(solid.container).getAttribute('fill')).toBe('currentColor');
    solid.unmount();

    const outline = render(<Icon name="favorite" />);
    expect(svgOf(outline.container).getAttribute('fill')).toBe('none');
    outline.unmount();

    const forced = render(<Icon name="favorite" filled />);
    expect(svgOf(forced.container).getAttribute('fill')).toBe('currentColor');
  });
});
