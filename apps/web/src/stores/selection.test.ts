import { beforeEach, describe, expect, it } from 'vitest';
import { rangeBetween, useSelection } from './selection';

const order = ['a', 'b', 'c', 'd', 'e'];
const sel = (): string[] => [...useSelection.getState().selected].sort();

beforeEach(() => {
  useSelection.setState({ selected: new Set(), anchor: null });
});

describe('selection store', () => {
  it('toggle adds, removes and moves the anchor', () => {
    const s = useSelection.getState();
    s.toggle('a');
    expect(sel()).toEqual(['a']);
    expect(useSelection.getState().anchor).toBe('a');
    s.toggle('b');
    expect(sel()).toEqual(['a', 'b']);
    s.toggle('a');
    expect(sel()).toEqual(['b']);
    expect(useSelection.getState().anchor).toBe('a');
  });
  it('toggle replaces the Set instance (selector friendly)', () => {
    const before = useSelection.getState().selected;
    useSelection.getState().toggle('a');
    expect(useSelection.getState().selected).not.toBe(before);
    expect(before.size).toBe(0);
  });
  it('range extends downward from the anchor', () => {
    const s = useSelection.getState();
    s.toggle('b');
    s.range('d', order);
    expect(sel()).toEqual(['b', 'c', 'd']);
  });
  it('range extends upward from the anchor', () => {
    const s = useSelection.getState();
    s.toggle('d');
    s.range('b', order);
    expect(sel()).toEqual(['b', 'c', 'd']);
  });
  it('range keeps the anchor so it can be extended again', () => {
    const s = useSelection.getState();
    s.toggle('c');
    s.range('e', order);
    s.range('a', order);
    expect(sel()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(useSelection.getState().anchor).toBe('c');
  });
  it('range keeps existing selection outside the range', () => {
    const s = useSelection.getState();
    s.toggle('a');
    s.toggle('c');
    s.range('e', order);
    expect(sel()).toEqual(['a', 'c', 'd', 'e']);
  });
  it('range without an anchor toggles the target', () => {
    const s = useSelection.getState();
    s.range('c', order);
    expect(sel()).toEqual(['c']);
    expect(useSelection.getState().anchor).toBe('c');
    useSelection.setState({ selected: new Set(['c']), anchor: null });
    useSelection.getState().range('c', order);
    expect(sel()).toEqual([]);
  });
  it('range to an id missing from the order selects only that id', () => {
    const s = useSelection.getState();
    s.toggle('a');
    s.range('zzz', order);
    expect(sel()).toEqual(['a', 'zzz']);
  });
  it('set replaces the selection and clears the anchor', () => {
    const s = useSelection.getState();
    s.toggle('a');
    s.set(['x', 'y', 'x']);
    expect(sel()).toEqual(['x', 'y']);
    expect(useSelection.getState().anchor).toBeNull();
  });
  it('clear empties the selection and the anchor', () => {
    const s = useSelection.getState();
    s.toggle('a');
    s.clear();
    expect(sel()).toEqual([]);
    expect(useSelection.getState().anchor).toBeNull();
  });
  it('clear is a no-op (same state object) when already empty', () => {
    const before = useSelection.getState().selected;
    useSelection.getState().clear();
    expect(useSelection.getState().selected).toBe(before);
  });
});

describe('rangeBetween', () => {
  it('is inclusive and direction independent', () => {
    expect(rangeBetween(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(order, 'c', 'c')).toEqual(['c']);
  });
  it('falls back to the target when either end is missing', () => {
    expect(rangeBetween(order, 'q', 'b')).toEqual(['b']);
    expect(rangeBetween(order, 'b', 'q')).toEqual(['q']);
  });
});
