import { create } from 'zustand';

/**
 * Multi-selection for issue lists (SPEC §4.12: X toggles, ⇧X selects a range).
 * `order` is the visible order of the active list, used for ranges.
 */
interface SelectionState {
  selected: ReadonlySet<string>;
  anchor: string | null;
  toggle: (id: string) => void;
  range: (to: string, order: readonly string[]) => void;
  set: (ids: Iterable<string>) => void;
  clear: () => void;
}

export function rangeBetween(order: readonly string[], a: string, b: string): string[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i === -1 || j === -1) return [b];
  const [lo, hi] = i <= j ? [i, j] : [j, i];
  return order.slice(lo, hi + 1);
}

export const useSelection = create<SelectionState>()((set, get) => ({
  selected: new Set(),
  anchor: null,
  toggle: (id) => {
    const next = new Set(get().selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selected: next, anchor: id });
  },
  range: (to, order) => {
    const { anchor, selected } = get();
    if (!anchor) {
      get().toggle(to);
      return;
    }
    const next = new Set(selected);
    for (const id of rangeBetween(order, anchor, to)) next.add(id);
    set({ selected: next });
  },
  set: (ids) => set({ selected: new Set(ids), anchor: null }),
  clear: () => {
    if (get().selected.size === 0 && get().anchor === null) return;
    set({ selected: new Set(), anchor: null });
  },
}));
