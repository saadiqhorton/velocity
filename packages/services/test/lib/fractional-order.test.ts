import { describe, expect, it } from 'vitest';
import { MIN_GAP, needsRebalance, neighboursForInsert, orderBetween, orderForMove, rebalance } from '../../src/lib/fractional-order';

describe('orderBetween', () => {
  it('handles empty list, open ends and midpoint', () => {
    expect(orderBetween(null, null)).toBe(1000);
    expect(orderBetween(null, 500)).toBe(-500);
    expect(orderBetween(500, null)).toBe(1500);
    expect(orderBetween(1000, 2000)).toBe(1500);
    expect(orderBetween(-10, 10)).toBe(0);
    expect(orderBetween(5, 5)).toBe(5);
  });
  it('rejects bad input', () => {
    expect(() => orderBetween(2, 1)).toThrow(RangeError);
    expect(() => orderBetween(NaN, 1)).toThrow(RangeError);
    expect(() => orderBetween(null, Infinity)).toThrow(RangeError);
  });
  it('repeated insertion at the end / start stays strictly ordered', () => {
    let v: number | null = null;
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      v = orderBetween(v, null);
      expect(seen.has(v)).toBe(false);
      seen.add(v);
    }
    let w: number | null = null;
    for (let i = 0; i < 2000; i++) {
      const n = orderBetween(null, w);
      if (w !== null) expect(n).toBeLessThan(w);
      w = n;
    }
  });
});

describe('needsRebalance', () => {
  it('false with open ends or comfortable gaps', () => {
    expect(needsRebalance(null, null)).toBe(false);
    expect(needsRebalance(null, 1)).toBe(false);
    expect(needsRebalance(1, null)).toBe(false);
    expect(needsRebalance(1000, 2000)).toBe(false);
    expect(needsRebalance(0, MIN_GAP * 2)).toBe(false);
  });
  it('true with tiny/zero/reversed gaps', () => {
    expect(needsRebalance(1, 1)).toBe(true);
    expect(needsRebalance(1, 1 + MIN_GAP / 2)).toBe(true);
    expect(needsRebalance(2, 1)).toBe(true);
    expect(needsRebalance(Number.NaN, 1)).toBe(true);
  });
});

describe('rebalance', () => {
  it('produces evenly spaced values', () => {
    expect(rebalance(0)).toEqual([]);
    expect(rebalance(3)).toEqual([1000, 2000, 3000]);
    expect(rebalance(3, 0, 10)).toEqual([0, 10, 20]);
  });
  it('validates', () => {
    expect(() => rebalance(-1)).toThrow(RangeError);
    expect(() => rebalance(1.5)).toThrow(RangeError);
    expect(() => rebalance(2, 0, 0)).toThrow(RangeError);
  });
});

describe('repeated insertion between the same neighbours', () => {
  it('triggers rebalance in time and never yields duplicates or NaN', () => {
    let list = [1000, 2000];
    let rebalances = 0;
    // always insert at index 1 (right after the first item): halving gap every time
    for (let i = 0; i < 3000; i++) {
      const { before, after } = neighboursForInsert(list, 1);
      if (needsRebalance(before, after)) {
        rebalances++;
        list = rebalance(list.length);
        continue;
      }
      const v = orderBetween(before, after);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(before as number);
      expect(v).toBeLessThan(after as number);
      list = [...list.slice(0, 1), v, ...list.slice(1)];
      if (i % 250 === 0) {
        expect(new Set(list).size).toBe(list.length);
        for (let k = 1; k < list.length; k++) expect(list[k]).toBeGreaterThan(list[k - 1] as number);
      }
    }
    expect(rebalances).toBeGreaterThan(10);
  });
  it('without rebalancing the float eventually collapses (justifies needsRebalance)', () => {
    let a = 1000;
    const b = 2000;
    let flagged = false;
    for (let i = 0; i < 100; i++) {
      if (needsRebalance(a, b)) {
        flagged = true;
        break;
      }
      a = orderBetween(a, b);
    }
    expect(flagged).toBe(true);
  });
});

describe('orderForMove', () => {
  const list = [10, 20, 30, 40];
  it('no-op returns current value', () => expect(orderForMove(list, 2, 2)).toBe(30));
  it('moves down', () => {
    expect(orderForMove(list, 0, 2)).toBe(35); // between 30 and 40
    expect(orderForMove(list, 0, 3)).toBe(1040);
  });
  it('moves up', () => {
    expect(orderForMove(list, 3, 0)).toBe(-990);
    expect(orderForMove(list, 3, 1)).toBe(15);
    expect(orderForMove(list, 2, 1)).toBe(15);
  });
  it('single-item list', () => expect(orderForMove([5], 0, 0)).toBe(5));
  it('validates indices', () => {
    expect(() => orderForMove(list, -1, 0)).toThrow(RangeError);
    expect(() => orderForMove(list, 0, 4)).toThrow(RangeError);
  });
  it('resulting list order matches the requested index', () => {
    for (let from = 0; from < list.length; from++)
      for (let to = 0; to < list.length; to++) {
        const v = orderForMove(list, from, to);
        const rest = list.filter((_, i) => i !== from);
        const next = [...rest.slice(0, to), v, ...rest.slice(to)].sort((a, b) => a - b);
        expect(next.indexOf(v)).toBe(to);
      }
  });
});

describe('neighboursForInsert', () => {
  it('bounds', () => {
    expect(neighboursForInsert([1, 2], 0)).toEqual({ before: null, after: 1 });
    expect(neighboursForInsert([1, 2], 2)).toEqual({ before: 2, after: null });
    expect(() => neighboursForInsert([1], 3)).toThrow(RangeError);
  });
});
