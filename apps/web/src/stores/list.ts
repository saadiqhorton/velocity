import { create } from 'zustand';

/**
 * The issue list that currently owns J/K focus. Lists publish their visible order so
 * global commands (S, A, L…) and ranges (⇧X) know the focused row and neighbors.
 */
interface ActiveListState {
  listId: string | null;
  order: readonly string[];
  focusedId: string | null;
  /** Context the list was created for (team id, project id) — create-issue defaults. */
  context: { teamId?: string; projectId?: string; cycleId?: string; statusId?: string } | null;
  setList: (listId: string, order: readonly string[], context?: ActiveListState['context']) => void;
  clearList: (listId: string) => void;
  setFocused: (id: string | null) => void;
}

export const useActiveList = create<ActiveListState>()((set, get) => ({
  listId: null,
  order: [],
  focusedId: null,
  context: null,
  setList: (listId, order, context = null) => {
    const s = get();
    const focusedId = s.focusedId && order.includes(s.focusedId) ? s.focusedId : s.listId === listId ? s.focusedId : null;
    set({ listId, order, focusedId, context });
  },
  clearList: (listId) => {
    if (get().listId === listId) set({ listId: null, order: [], focusedId: null, context: null });
  },
  setFocused: (focusedId) => set({ focusedId }),
}));
