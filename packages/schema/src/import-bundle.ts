/**
 * Normalized import format (SPEC §6.7). Every importer (Linear CSV/API, GitHub Issues,
 * Jira CSV) produces an ImportBundle; the ImporterService maps it onto the workspace
 * (mapping preview → dry-run → chunked commit). Pure types only.
 */
import type { ImportSource, Priority, StatusCategory, RelationType, ProjectStatus } from './enums';

export interface ImportWarning {
  /** Stable machine code, e.g. `unknown_priority`, `attachment_not_imported`, `missing_team`. */
  code: string;
  message: string;
  /** External id of the record that produced the warning, when applicable. */
  externalId?: string;
}

export interface ImportTeam {
  externalId: string;
  /** Suggested key (uppercase, 1–10 chars) — may collide; mapping resolves. */
  key: string;
  name: string;
}

export interface ImportStatus {
  teamExternalId: string;
  name: string;
  /** Inferred category; null when the importer could not infer one (mapping preview highlights it). */
  category: StatusCategory | null;
}

export interface ImportUser {
  externalId: string;
  name: string;
  email?: string | null;
  username?: string | null;
}

export interface ImportLabel {
  name: string;
  /** Optional parent group name (e.g. Jira issue types → group "Type"). */
  group?: string | null;
}

export interface ImportMilestone {
  externalId: string;
  name: string;
  targetDate?: string | null;
}

export interface ImportProject {
  externalId: string;
  name: string;
  descriptionMd?: string | null;
  status?: ProjectStatus | null;
  targetDate?: string | null;
  leadExternalId?: string | null;
  milestones: ImportMilestone[];
}

export interface ImportCycle {
  externalId: string;
  teamExternalId: string;
  number: number;
  name?: string | null;
  startsAt: string;
  endsAt: string;
}

export interface ImportComment {
  externalId?: string | null;
  authorExternalId?: string | null;
  /** Display name fallback when the author can't be mapped to a member. */
  authorName?: string | null;
  bodyMd: string;
  createdAt?: string | null;
}

export interface ImportRelation {
  type: RelationType;
  /** Issue external id of the other end. `blocks`: this issue blocks target. `duplicate`: this duplicates target. */
  targetExternalId: string;
}

export interface ImportIssue {
  /** Source identifier, e.g. `ENG-12` (Linear), `PROJ-3` (Jira), `owner/repo#12` (GitHub). */
  externalId: string;
  teamExternalId: string;
  title: string;
  descriptionMd?: string | null;
  statusName: string;
  priority?: Priority | null;
  estimate?: number | null;
  assigneeExternalId?: string | null;
  creatorExternalId?: string | null;
  labelNames: string[];
  projectExternalId?: string | null;
  milestoneExternalId?: string | null;
  cycleExternalId?: string | null;
  parentExternalId?: string | null;
  relations: ImportRelation[];
  comments: ImportComment[];
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  canceledAt?: string | null;
  archivedAt?: string | null;
  /** Attachments are noted for manual re-upload, never fetched (SPEC §6.7). */
  attachments: { name: string; url: string }[];
}

export interface ImportBundle {
  source: ImportSource;
  teams: ImportTeam[];
  statuses: ImportStatus[];
  users: ImportUser[];
  labels: ImportLabel[];
  projects: ImportProject[];
  cycles: ImportCycle[];
  issues: ImportIssue[];
  warnings: ImportWarning[];
}

/** User-editable mapping produced by the preview step (suggested defaults pre-filled). */
export interface ImportMapping {
  /** teamExternalId → target */
  teams: Record<string, { mode: 'existing'; teamId: string } | { mode: 'create'; key: string; name: string }>;
  /** `${teamExternalId}::${statusName}` → target. `create` adds a status to the team's workflow. */
  statuses: Record<
    string,
    { mode: 'existing'; statusId: string } | { mode: 'create'; name: string; category: StatusCategory }
  >;
  /** userExternalId → member, or null to leave unassigned (comments fall back to the importing user + author name). */
  users: Record<string, { userId: string } | null>;
  /** Import projects/cycles/comments/relations toggles. */
  include: { projects: boolean; cycles: boolean; comments: boolean; relations: boolean; archived: boolean };
}

/** Snapshot of the workspace the mapping suggester needs (passed in by the service — keeps importers pure). */
export interface ImportWorkspaceSnapshot {
  teams: { id: string; key: string; name: string; statuses: { id: string; name: string; category: StatusCategory }[] }[];
  /** Includes historical keys so suggested new mappings never reuse an old identifier prefix. */
  reservedTeamKeys?: string[];
  users: { id: string; username: string; name: string; email: string | null }[];
  labels: { id: string; name: string }[];
}

export interface ImportDryRunReport {
  counts: {
    teamsToCreate: number;
    statusesToCreate: number;
    labelsToCreate: number;
    projectsToCreate: number;
    cyclesToCreate: number;
    issues: number;
    comments: number;
    relations: number;
    skippedIssues: number;
  };
  unmapped: { users: string[]; statuses: string[]; teams: string[] };
  warnings: ImportWarning[];
}
