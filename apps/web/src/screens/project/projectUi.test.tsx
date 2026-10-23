import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MilestoneIcon } from './projectUi';

describe('milestone completion diamond', () => {
  it('uses the actual rollup even when milestone status has not changed', () => {
    const { container, rerender } = render(<MilestoneIcon status="planned" percent={0} />);
    expect(container.querySelector('path[fill="currentColor"]')).toBeNull();
    rerender(<MilestoneIcon status="planned" percent={50} />);
    expect(container.querySelector('clipPath rect')?.getAttribute('y')).toBe('6');
    expect(container.querySelector('svg')?.style.color).toBe('var(--ds-color-warning)');
    rerender(<MilestoneIcon status="planned" percent={100} />);
    expect(container.querySelector('path[fill="currentColor"]')).not.toBeNull();
    expect(container.querySelector('clipPath')).toBeNull();
    expect(container.querySelector('svg')?.style.color).toBe('var(--ds-color-primary)');
  });

  it.each([10, 25, 50, 75, 90])('fills %i percent of the diamond area', (percent) => {
    const { container } = render(<MilestoneIcon status="planned" percent={percent} />);
    const y = Number(container.querySelector('clipPath rect')?.getAttribute('y'));
    // Each half has area 25. A clipped tip is a triangle with area equal to its height squared.
    const filledArea = y >= 6 ? (11 - y) ** 2 : 50 - (y - 1) ** 2;
    expect(filledArea / 50).toBeCloseTo(percent / 100);
  });

  it('clamps invalid values and gives multiple partial diamonds unique clip paths', () => {
    const { container, rerender } = render(<><MilestoneIcon status="planned" percent={25} /><MilestoneIcon status="planned" percent={75} /></>);
    const ids = [...container.querySelectorAll('clipPath')].map((clip) => clip.id);
    expect(new Set(ids).size).toBe(2);
    rerender(<MilestoneIcon status="planned" percent={150} />);
    expect(container.querySelector('path[fill="currentColor"]')).not.toBeNull();
    rerender(<MilestoneIcon status="done" percent={Number.NaN} />);
    expect(container.querySelector('path[fill="currentColor"]')).toBeNull();
  });
});
