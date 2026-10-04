/** Shared domain enums (SPEC §3). Pure — safe to import from any package, including the web app. */

export const STATUS_CATEGORIES = ['backlog', 'todo', 'in_progress', 'done', 'canceled'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/** 0 Urgent, 1 High, 2 Medium (default), 3 Low, 4 No priority (SPEC §3.5). */
export const PRIORITIES = [0, 1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_NAMES: Record<Priority, 'urgent' | 'high' | 'medium' | 'low' | 'none'> = {
  0: 'urgent',
  1: 'high',
  2: 'medium',
  3: 'low',
  4: 'none',
};
export const DEFAULT_PRIORITY: Priority = 2;

export const RELATION_TYPES = ['blocks', 'related', 'duplicate'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export const PROJECT_STATUSES = ['planned', 'in_progress', 'completed', 'canceled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_HEALTH = ['on_track', 'at_risk', 'off_track'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTH)[number];

export const MILESTONE_STATUSES = ['planned', 'in_progress', 'done'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const PALETTE_COLORS = ['blue', 'green', 'red', 'yellow', 'purple', 'teal', 'grey', 'pink'] as const;
export type PaletteColor = (typeof PALETTE_COLORS)[number];

export const API_KEY_SCOPES = ['read', 'write'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const CARRY_OVER = ['next_cycle', 'backlog'] as const;
export type CarryOver = (typeof CARRY_OVER)[number];

export const IMPORT_SOURCES = ['linear', 'github', 'jira'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const VIEW_GROUPINGS = ['status', 'assignee', 'priority', 'label', 'project', 'cycle', 'team', 'none'] as const;
export type ViewGrouping = (typeof VIEW_GROUPINGS)[number];

export const VIEW_ORDERINGS = ['priority', 'status', 'created', 'updated', 'estimate', 'manual'] as const;
export type ViewOrdering = (typeof VIEW_ORDERINGS)[number];

export const VIEW_LAYOUTS = ['list', 'board'] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

export const NOTIFICATION_TYPES = [
  'assigned',
  'mentioned',
  'comment',
  'status_changed',
  'priority_changed',
  'relation_added',
  'github_pr_linked',
  'github_pr_merged',
  'github_review',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const WEBHOOK_EVENT_TYPES = [
  'issue.created',
  'issue.updated',
  'issue.status_changed',
  'issue.assigned',
  'comment.created',
  'cycle.started',
  'cycle.closed',
  'project.updated',
  'import.completed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Team key: uppercase alphanumeric, 1–10 chars, must start with a letter (SPEC §3.1). */
export const TEAM_KEY_RE = /^[A-Z][A-Z0-9]{0,9}$/;
export const MAX_SUB_ISSUE_DEPTH = 5;
export const MAX_STATUSES_PER_TEAM = 20;
export const MAX_LABELS_PER_ISSUE = 10;
export const MAX_ESTIMATE = 40;
