import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RecentIssue {
  id: string;
  identifier: string;
  title: string;
}

interface RecentState {
  issues: RecentIssue[];
  searches: string[];
  pushIssue: (issue: RecentIssue) => void;
  pushSearch: (q: string) => void;
  clearSearches: () => void;
}

/** Recently opened issues and searches (palette "Recent", search screen). */
export const useRecent = create<RecentState>()(
  persist(
    (set) => ({
      issues: [],
      searches: [],
      pushIssue: (issue) => set((s) => ({ issues: [issue, ...s.issues.filter((i) => i.id !== issue.id)].slice(0, 8) })),
      pushSearch: (q) => {
        const t = q.trim();
        if (t.length < 2) return;
        set((s) => ({ searches: [t, ...s.searches.filter((x) => x !== t)].slice(0, 8) }));
      },
      clearSearches: () => set({ searches: [] }),
    }),
    { name: 'vel.recent' },
  ),
);
