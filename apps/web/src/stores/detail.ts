import { create } from 'zustand';

/** The issue currently shown in the panel or full page (target for S/A/L… when focused there). */
interface DetailState {
  issueId: string | null;
  teamId: string | null;
  setIssue: (issueId: string | null, teamId?: string | null) => void;
}

export const useDetailIssue = create<DetailState>()((set) => ({
  issueId: null,
  teamId: null,
  setIssue: (issueId, teamId = null) => set({ issueId, teamId }),
}));
