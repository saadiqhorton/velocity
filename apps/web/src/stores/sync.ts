import { create } from 'zustand';

/** Sync pulse (SPEC §5.5): rows whose server reconcile took > 300ms flash for 200ms. */
interface SyncState {
  pulses: Record<string, number>;
  pulse: (ids: string[]) => void;
}

let token = 0;

export const useSync = create<SyncState>()((set) => ({
  pulses: {},
  pulse: (ids) => {
    if (ids.length === 0) return;
    token += 1;
    const t = token;
    set((s) => ({ pulses: { ...s.pulses, ...Object.fromEntries(ids.map((id) => [id, t])) } }));
    setTimeout(() => {
      set((s) => {
        const next = { ...s.pulses };
        for (const id of ids) if (next[id] === t) delete next[id];
        return { pulses: next };
      });
    }, 220);
  },
}));

export function usePulse(id: string): number | undefined {
  return useSync((s) => s.pulses[id]);
}
