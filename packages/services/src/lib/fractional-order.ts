/**
 * Fractional ordering for `sort_order` (float) within a group (SPEC §3.5).
 *
 * Items are positioned by a double. Inserting between two neighbours takes the
 * midpoint; once the gap shrinks below `MIN_GAP` the caller should rebalance the
 * group (`rebalance`) and re-run the insertion.
 */

/** Default spacing between items and at open ends. */
export const ORDER_STEP = 1000;
/** Gaps smaller than this are considered exhausted (well above double epsilon at the magnitudes we use). */
export const MIN_GAP = 1e-6;

/**
 * Value to place between `before` (lower neighbour, null = none) and `after`
 * (upper neighbour, null = none).
 */
export function orderBetween(before: number | null, after: number | null): number {
  if (before !== null && !Number.isFinite(before)) throw new RangeError('before must be finite');
  if (after !== null && !Number.isFinite(after)) throw new RangeError('after must be finite');
  if (before === null && after === null) return ORDER_STEP;
  if (before === null) return (after as number) - ORDER_STEP;
  if (after === null) return before + ORDER_STEP;
  if (before > after) throw new RangeError('before must not be greater than after');
  return before + (after - before) / 2;
}

/**
 * True when there is no safe room to insert between the neighbours: the gap is
 * below `MIN_GAP` or the midpoint collapses onto one of them.
 */
export function needsRebalance(before: number | null, after: number | null): boolean {
  if (before === null || after === null) return false;
  const gap = after - before;
  if (!(gap >= MIN_GAP)) return true;
  const mid = before + gap / 2;
  return mid <= before || mid >= after;
}

/** `count` evenly spaced values: start, start+step, ... */
export function rebalance(count: number, start: number = ORDER_STEP, step: number = ORDER_STEP): number[] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer');
  if (!(step > 0) || !Number.isFinite(step) || !Number.isFinite(start)) throw new RangeError('invalid start/step');
  return Array.from({ length: count }, (_, i) => start + i * step);
}

/**
 * New sort value for the item currently at `fromIndex` of the ascending `list`
 * when it is dropped so that it ends up at `toIndex` of the resulting list
 * (indices as seen by the user after the move). Returns the new value; callers
 * check `needsRebalance` against the neighbours first when they want to heal.
 * Returns the item's current value when the move is a no-op.
 */
export function orderForMove(list: readonly number[], fromIndex: number, toIndex: number): number {
  const n = list.length;
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= n) throw new RangeError('fromIndex out of range');
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= n) throw new RangeError('toIndex out of range');
  if (fromIndex === toIndex) return list[fromIndex] as number;
  const rest = list.filter((_, i) => i !== fromIndex);
  const before = toIndex > 0 ? (rest[toIndex - 1] as number) : null;
  const after = toIndex < rest.length ? (rest[toIndex] as number) : null;
  return orderBetween(before, after);
}

/** Neighbour values around `index` in `list` for an insertion at that index (new item ends up at `index`). */
export function neighboursForInsert(list: readonly number[], index: number): { before: number | null; after: number | null } {
  if (!Number.isInteger(index) || index < 0 || index > list.length) throw new RangeError('index out of range');
  return { before: index > 0 ? (list[index - 1] as number) : null, after: index < list.length ? (list[index] as number) : null };
}
