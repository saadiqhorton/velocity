import { create } from 'zustand';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

interface ConnectionState {
  status: ConnectionStatus;
  /** Browser-reported network state. */
  online: boolean;
  /** When the outage started (ms epoch); null while healthy. */
  downSince: number | null;
  setStatus: (status: ConnectionStatus) => void;
  setOnline: (online: boolean) => void;
}

export const useConnection = create<ConnectionState>()((set, get) => ({
  status: 'idle',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  downSince: null,
  setStatus: (status) => {
    const down = status === 'disconnected' || !get().online;
    set({ status, downSince: down ? (get().downSince ?? Date.now()) : null });
  },
  setOnline: (online) => {
    const down = !online || get().status === 'disconnected';
    set({ online, downSince: down ? (get().downSince ?? Date.now()) : null });
  },
}));
