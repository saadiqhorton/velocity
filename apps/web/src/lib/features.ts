/**
 * Workspace feature flags for Solo mode (Roadmap v1.2 U4). The API keeps accepting cycle
 * and estimate fields whatever the flags say (S1: hiding is UI-only), so these only decide
 * what the web app shows.
 */
import { useWorkspace } from '@/app/workspace';
import type { WorkspaceData } from '@/app/workspace';

export interface Features {
  cycles: boolean;
  estimates: boolean;
  insights: boolean;
  members: boolean;
  /** True when all four are off. */
  solo: boolean;
}

export const ALL_FEATURES: Features = { cycles: true, estimates: true, insights: true, members: true, solo: false };

/** Reads `workspace.features`; a server without the field (older API) means everything on. */
export function featuresOf(workspace: WorkspaceData['workspace'] | null | undefined): Features {
  const f = (workspace as { features?: Partial<Features> | null } | null | undefined)?.features;
  if (!f) return ALL_FEATURES;
  const cycles = f.cycles !== false;
  const estimates = f.estimates !== false;
  const insights = f.insights !== false;
  const members = f.members !== false;
  return { cycles, estimates, insights, members, solo: !cycles && !estimates && !insights && !members };
}

export function useFeatures(): Features {
  return featuresOf(useWorkspace().workspace);
}

/** Cycles show for a team only when the workspace feature and the team setting are both on. */
export function teamUsesCycles(features: Features, team: { cycleEnabled: boolean } | null | undefined): boolean {
  return features.cycles && Boolean(team?.cycleEnabled);
}
