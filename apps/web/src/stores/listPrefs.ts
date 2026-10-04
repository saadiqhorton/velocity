import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Collapsed groups per list (persisted per browser). */
interface ListPrefsState {
  collapsed: Record<string, string[]>;
  toggleGroup: (listId: string, token: string) => void;
}

export const useListPrefs = create<ListPrefsState>()(
  persist(
    (set) => ({
      collapsed: {},
      toggleGroup: (listId, token) =>
        set((s) => {
          const cur = new Set(s.collapsed[listId] ?? []);
          if (cur.has(token)) cur.delete(token);
          else cur.add(token);
          return { collapsed: { ...s.collapsed, [listId]: [...cur] } };
        }),
    }),
    { name: 'vel.listPrefs' },
  ),
);

const EMPTY: readonly string[] = [];

export function useCollapsedGroups(listId: string): ReadonlySet<string> {
  const list = useListPrefs((s) => s.collapsed[listId] ?? EMPTY);
  return toSet(list);
}

const cache = new WeakMap<readonly string[], ReadonlySet<string>>();
function toSet(list: readonly string[]): ReadonlySet<string> {
  let set = cache.get(list);
  if (!set) {
    set = new Set(list);
    cache.set(list, set);
  }
  return set;
}
