import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Collapsed sidebar groups persist per browser (SPEC §4.9.15). */
interface SidebarState {
  collapsed: Record<string, boolean>;
  drawerOpen: boolean;
  setCollapsed: (key: string, collapsed: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
}

export const useSidebar = create<SidebarState>()(
  persist(
    (set) => ({
      collapsed: {},
      drawerOpen: false,
      setCollapsed: (key, collapsed) => set((s) => ({ collapsed: { ...s.collapsed, [key]: collapsed } })),
      setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
    }),
    { name: 'vel.sidebar', partialize: (s) => ({ collapsed: s.collapsed }) },
  ),
);
