/**
 * Velocity data model (SPEC §5.11). PostgreSQL 16, Drizzle ORM.
 *
 * - Primary keys are UUID v7 (time-ordered), generated in the app.
 * - No `workspace_id` columns: one deployment = one workspace (SPEC §5.1 ADR 4).
 * - All FKs are ON DELETE RESTRICT except owned children (comments, reactions,
 *   cycle_history, notifications, …) which cascade.
 *
 * Additions beyond the SPEC table list (recorded in docs/architecture.md):
 *   workspace (singleton settings row), invites, team_counters, project_teams,
 *   issue_activity (timeline), favorites (orderable), mcp_sessions, import_items
 *   (resumable import idempotency), exports.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import type {
  ApiKeyScope,
  CarryOver,
  ImportSource,
  MilestoneStatus,
  NotificationType,
  PaletteColor,
  ProjectHealth,
  ProjectStatus,
  RelationType,
  StatusCategory,
} from './enums';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();

export interface WorkspaceFeatures {
  cycles: boolean;
  estimates: boolean;
  insights: boolean;
  members: boolean;
}

/** New workspaces start with team features hidden in the UI. */
export const SOLO_WORKSPACE_FEATURES: WorkspaceFeatures = {
  cycles: false,
  estimates: false,
  insights: false,
  members: false,
};

export interface CodingToolPreference {
  id: string;
  preset?: string;
  name: string;
  kind: 'deeplink' | 'command';
  template: string;
  enabled: boolean;
  shortcut?: string;
}

export interface UserPreferences {
  codingTools: CodingToolPreference[];
  promptInstructions: string;
}

// ───────────────────────────── Workspace & identity ─────────────────────────────

export const workspace = pgTable(
  'workspace',
  {
    id: smallint('id').primaryKey().default(1),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    locale: text('locale').notNull().default('en'),
    features: jsonb('features').$type<WorkspaceFeatures>().notNull().default(SOLO_WORKSPACE_FEATURES),
    setupCompletedAt: ts('setup_completed_at'),
    /** Owner-requested deletion; data retained 7 days, then purged (SPEC §3.3). */
    deletionRequestedAt: ts('deletion_requested_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('workspace_singleton', sql`${t.id} = 1`)],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    username: citext('username').notNull(),
    email: citext('email'),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    avatarPath: text('avatar_path'),
    timezone: text('timezone').notNull().default('UTC'),
    locale: text('locale').notNull().default('en'),
    theme: text('theme').$type<'dark' | 'light' | 'system'>().notNull().default('system'),
    /** Null means no server setting has been saved; clients may migrate local settings once. */
    preferences: jsonb('preferences').$type<UserPreferences>(),
    isOwner: boolean('is_owner').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    suspendedAt: ts('suspended_at'),
    /** Account deleted: row kept as a "Former member" stub so history stays attributed (SPEC §7.2). */
    deletedAt: ts('deleted_at'),
  },
  (t) => [uniqueIndex('users_username_uq').on(t.username), uniqueIndex('users_email_uq').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfToken: text('csrf_token').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Display/lookup prefix (`vel_` + 8 chars); the full key is only shown once. */
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scope: text('scope').$type<ApiKeyScope>().notNull(),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_keys_prefix_uq').on(t.prefix), index('api_keys_user_idx').on(t.userId)],
);

export const invites = pgTable(
  'invites',
  {
    id: id(),
    tokenHash: text('token_hash').notNull(),
    /** Optional name hint shown on the accept screen. */
    name: text('name'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    usedByUserId: uuid('used_by_user_id').references(() => users.id),
    revokedAt: ts('revoked_at'),
  },
  (t) => [uniqueIndex('invites_token_uq').on(t.tokenHash)],
);

export const mcpSessions = pgTable('mcp_sessions', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
  clientName: text('client_name'),
  transport: text('transport').$type<'stdio' | 'http'>().notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
});

// ───────────────────────────── Teams & workflows ─────────────────────────────

export const teams = pgTable(
  'teams',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    icon: text('icon'),
    color: text('color').$type<PaletteColor>().notNull().default('blue'),
    description: text('description'),
    cycleEnabled: boolean('cycle_enabled').notNull().default(false),
    cycleLengthWeeks: smallint('cycle_length_weeks').notNull().default(2),
    /** 0 = Sunday … 6 = Saturday */
    cycleStartDay: smallint('cycle_start_day').notNull().default(1),
    cycleTimezone: text('cycle_timezone').notNull().default('UTC'),
    carryOver: text('carry_over').$type<CarryOver>().notNull().default('next_cycle'),
    estimateScale: text('estimate_scale')
      .$type<'linear' | 'fibonacci' | 'exponential' | 'tshirt'>()
      .notNull()
      .default('fibonacci'),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    archivedAt: ts('archived_at'),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('teams_key_uq').on(t.key),
    check('teams_key_format', sql`${t.key} ~ '^[A-Z][A-Z0-9]{0,9}$'`),
    check('teams_cycle_len', sql`${t.cycleLengthWeeks} between 1 and 8`),
    check('teams_cycle_day', sql`${t.cycleStartDay} between 0 and 6`),
  ],
);

/** Every key ever assigned to a team stays reserved, including after soft deletion. */
export const teamKeyAliases = pgTable(
  'team_key_aliases',
  {
    key: text('key').primaryKey(),
    // Deliberately no FK: a later retention purge must not make old keys reusable.
    teamId: uuid('team_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('team_key_aliases_team_idx').on(t.teamId), check('team_key_aliases_format', sql`${t.key} ~ '^[A-Z][A-Z0-9]{0,9}$'`)],
);

export const teamMembers = pgTable(
  'team_members',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('team_members_uq').on(t.teamId, t.userId)],
);

/** Gapless per-team issue numbering: row locked FOR UPDATE inside the create tx (SPEC §5.11). */
export const teamCounters = pgTable('team_counters', {
  teamId: uuid('team_id')
    .primaryKey()
    .references(() => teams.id, { onDelete: 'cascade' }),
  nextNumber: integer('next_number').notNull().default(1),
});

export const workflows = pgTable(
  'workflows',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
  },
  (t) => [uniqueIndex('workflows_team_uq').on(t.teamId)],
);

export const statuses = pgTable(
  'statuses',
  {
    id: id(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    /** Denormalized from workflows for cheap filtering. */
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').$type<StatusCategory>().notNull(),
    color: text('color').$type<PaletteColor>().notNull(),
    order: doublePrecision('order').notNull(),
    description: text('description'),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    index('statuses_team_idx').on(t.teamId),
    uniqueIndex('statuses_name_uq')
      .on(t.workflowId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    check(
      'statuses_category',
      sql`${t.category} in ('backlog','todo','in_progress','done','canceled')`,
    ),
  ],
);

export const labels = pgTable(
  'labels',
  {
    id: id(),
    name: text('name').notNull(),
    color: text('color').$type<PaletteColor>().notNull().default('grey'),
    description: text('description'),
    /** Group parent (SPEC §3.7 "group (parent for picker grouping)"). */
    parentId: uuid('parent_label_id'),
    isGroup: boolean('is_group').notNull().default(false),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('labels_name_uq').on(sql`lower(${t.name})`)],
);

// ───────────────────────────── Projects & cycles ─────────────────────────────

export const projects = pgTable(
  'projects',
  {
    id: id(),
    name: text('name').notNull(),
    descriptionMd: text('description_md').notNull().default(''),
    icon: text('icon'),
    color: text('color').$type<PaletteColor>().notNull().default('blue'),
    status: text('status').$type<ProjectStatus>().notNull().default('planned'),
    leadId: uuid('lead_id').references(() => users.id),
    targetDate: date('target_date', { mode: 'string' }),
    health: text('health').$type<ProjectHealth>(),
    progressDone: integer('progress_done').notNull().default(0),
    progressTotal: integer('progress_total').notNull().default(0),
    progressPointsDone: integer('progress_points_done').notNull().default(0),
    progressPointsTotal: integer('progress_points_total').notNull().default(0),
    autoArchive: boolean('auto_archive').notNull().default(false),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    archivedAt: ts('archived_at'),
    trashedAt: ts('trashed_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('projects_status_idx').on(t.status)],
);

export const projectTeams = pgTable(
  'project_teams',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.teamId] })],
);

export const milestones = pgTable(
  'milestones',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    targetDate: date('target_date', { mode: 'string' }),
    status: text('status').$type<MilestoneStatus>().notNull().default('planned'),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('milestones_project_idx').on(t.projectId)],
);

export interface CycleStats {
  scopeCount: number;
  scopePoints: number;
  completedCount: number;
  completedPoints: number;
  canceledCount: number;
  addedAfterStartCount: number;
  removedCount: number;
  carriedOverCount: number;
}

export const cycles = pgTable(
  'cycles',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name'),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    closedAt: ts('closed_at'),
    /** Immutable snapshot written at close (SPEC §3.8). */
    stats: jsonb('stats').$type<CycleStats>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('cycles_team_number_uq').on(t.teamId, t.number), index('cycles_team_ends_idx').on(t.teamId, t.endsAt)],
);

// ───────────────────────────── Issues ─────────────────────────────

export const issues = pgTable(
  'issues',
  {
    id: id(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    descriptionMd: text('description_md').notNull().default(''),
    statusId: uuid('status_id')
      .notNull()
      .references(() => statuses.id),
    assigneeId: uuid('assignee_id').references(() => users.id),
    priority: smallint('priority').notNull().default(2),
    estimate: smallint('estimate'),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    parentId: uuid('parent_id'),
    projectId: uuid('project_id').references(() => projects.id),
    milestoneId: uuid('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
    cycleId: uuid('cycle_id').references(() => cycles.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    canceledAt: ts('canceled_at'),
    archivedAt: ts('archived_at'),
    trashedAt: ts('trashed_at'),
    movedToIssueId: uuid('moved_to_issue_id'),
    /** Maintained by trigger: title (A) + description (C) + comments (C) (SPEC §5.7). */
    searchVector: tsvector('search_vector'),
  },
  (t) => [
    uniqueIndex('issues_team_number_uq').on(t.teamId, t.number),
    index('issues_team_status_idx').on(t.teamId, t.statusId),
    // SPEC §7.3: ordered active lists at 10k issues without sorting the whole team.
    index('issues_active_team_priority_idx').on(t.teamId, t.priority, t.updatedAt.desc(), t.createdAt.desc(), t.id)
      .where(sql`${t.trashedAt} is null and ${t.archivedAt} is null and ${t.movedToIssueId} is null`),
    index('issues_assignee_idx').on(t.assigneeId),
    index('issues_cycle_idx').on(t.cycleId),
    index('issues_project_idx').on(t.projectId),
    index('issues_parent_idx').on(t.parentId),
    index('issues_sort_idx').on(t.sortOrder.desc()),
    index('issues_updated_idx').on(t.updatedAt),
    index('issues_created_idx').on(t.createdAt),
    index('issues_search_idx').using('gin', t.searchVector),
    check('issues_priority', sql`${t.priority} between 0 and 4`),
    check('issues_estimate', sql`${t.estimate} is null or ${t.estimate} between 0 and 40`),
    check('issues_title_len', sql`char_length(${t.title}) between 1 and 512`),
    check('issues_not_own_parent', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

export const issueLabels = pgTable(
  'issue_labels',
  {
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] }), index('issue_labels_label_idx').on(t.labelId)],
);

export const issueRelations = pgTable(
  'issue_relations',
  {
    id: id(),
    sourceIssueId: uuid('source_issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    targetIssueId: uuid('target_issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    type: text('type').$type<RelationType>().notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('issue_relations_not_self', sql`${t.sourceIssueId} <> ${t.targetIssueId}`),
    check('issue_relations_type', sql`${t.type} in ('blocks','related','duplicate')`),
    uniqueIndex('issue_relations_uq').on(t.sourceIssueId, t.targetIssueId, t.type),
    // Mirrored-inversion constraint: (a,b,type) and (b,a,type) can't both exist.
    uniqueIndex('issue_relations_pair_uq').on(
      sql`least(${t.sourceIssueId}, ${t.targetIssueId})`,
      sql`greatest(${t.sourceIssueId}, ${t.targetIssueId})`,
      t.type,
    ),
    index('issue_relations_target_idx').on(t.targetIssueId),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: id(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id),
    /** Display name for imported/GitHub comments whose author is not a member. */
    authorName: text('author_name'),
    source: text('source').$type<'app' | 'github' | 'import'>().notNull().default('app'),
    bodyMd: text('body_md').notNull(),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [index('comments_issue_idx').on(t.issueId, t.createdAt)],
);

export const reactions = pgTable(
  'reactions',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId, t.emoji] })],
);

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id').references(() => users.id),
    storagePath: text('storage_path').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    createdAt: createdAt(),
    trashedAt: ts('trashed_at'),
  },
  (t) => [index('attachments_issue_idx').on(t.issueId)],
);

export type ActivityActorKind = 'user' | 'api_key' | 'mcp' | 'github' | 'system' | 'import';

/** Issue timeline: every property change emits a row (SPEC §3.5.1, §3.5.4). */
export const issueActivity = pgTable(
  'issue_activity',
  {
    id: id(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorKind: text('actor_kind').$type<ActivityActorKind>().notNull().default('user'),
    type: text('type').notNull(),
    fromValue: jsonb('from_value'),
    toValue: jsonb('to_value'),
    createdAt: createdAt(),
  },
  (t) => [index('issue_activity_issue_idx').on(t.issueId, t.createdAt)],
);

export const cycleHistory = pgTable(
  'cycle_history',
  {
    id: id(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => cycles.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    addedAt: ts('added_at').notNull().defaultNow(),
    removedAt: ts('removed_at'),
  },
  (t) => [index('cycle_history_cycle_idx').on(t.cycleId), index('cycle_history_issue_idx').on(t.issueId)],
);

// ───────────────────────────── Views, favorites ─────────────────────────────

export interface ViewFilter {
  /** Canonical filter DSL (SPEC §6.1.4) — chips compile to/from it. */
  dsl: string;
}
export interface ViewDisplay {
  grouping: 'status' | 'assignee' | 'priority' | 'label' | 'project' | 'cycle' | 'team' | 'none';
  ordering: 'priority' | 'status' | 'created' | 'updated' | 'estimate' | 'manual';
  layout: 'list' | 'board';
  columns: string[];
  showSubIssues?: boolean;
  showEmptyGroups?: boolean;
  showCompleted?: 'all' | 'week' | 'month' | 'none';
}

export const views = pgTable(
  'views',
  {
    id: id(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
    color: text('color').$type<PaletteColor>(),
    filter: jsonb('filter').$type<ViewFilter>().notNull(),
    display: jsonb('display').$type<ViewDisplay>().notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('views_slug_uq').on(t.slug), index('views_owner_idx').on(t.ownerId)],
);

export type FavoriteKind = 'view' | 'project' | 'team' | 'issue' | 'cycle';

/** Orderable favorites (SPEC §4.10.3 "Favorites (starred views, orderable)"). */
export const favorites = pgTable(
  'favorites',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<FavoriteKind>().notNull(),
    targetId: uuid('target_id').notNull(),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('favorites_uq').on(t.userId, t.kind, t.targetId)],
);

// ───────────────────────────── Notifications ─────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').$type<NotificationType>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt), index('notifications_unread_idx').on(t.userId).where(sql`${t.readAt} is null`)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.userId] }), index('subscriptions_user_idx').on(t.userId)],
);

// ───────────────────────────── Integrations ─────────────────────────────

export const webhooks = pgTable('webhooks', {
  id: id(),
  url: text('url').notNull(),
  description: text('description'),
  /** AES-256-GCM encrypted (SPEC §7.1.3) — needed in plaintext to sign deliveries. */
  secretEncrypted: text('secret_encrypted').notNull(),
  eventTypes: text('event_types').array().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').$type<'pending' | 'success' | 'failed' | 'dead'>().notNull().default('pending'),
    statusCode: integer('status_code'),
    error: text('error'),
    attempt: integer('attempt').notNull().default(0),
    durationMs: integer('duration_ms'),
    nextRetryAt: ts('next_retry_at'),
    deliveredAt: ts('delivered_at'),
    createdAt: createdAt(),
  },
  (t) => [index('webhook_deliveries_webhook_idx').on(t.webhookId, t.createdAt)],
);

export interface GithubInstallSettings {
  accountLogin: string;
  accountType: 'User' | 'Organization';
  repos: string[];
  /** repo full name (owner/name) → team id; unmapped repos auto-match team key ↔ repo name. */
  repoTeamMap: Record<string, string>;
  autoCloseOnMerge: boolean;
  issueSync: boolean;
  /** Target team for synced GitHub issues when the repo isn't mapped. */
  issueSyncTeamId?: string | null;
}

/**
 * A GitHub App created from inside Velocity through GitHub's manifest flow. Singleton, like
 * `workspace`. Secrets are stored AES-256-GCM-encrypted (the same `createCipherBox` used for
 * webhook secrets) and override the `GITHUB_APP_*` environment variables when present. This is
 * the documented deviation from "secrets env-only": a self-hoster with no server file access can
 * connect GitHub from the web UI.
 */
export const githubApp = pgTable(
  'github_app',
  {
    id: smallint('id').primaryKey().default(1),
    appId: text('app_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    clientId: text('client_id').notNull().default(''),
    clientSecretEncrypted: text('client_secret_encrypted').notNull(),
    privateKeyEncrypted: text('private_key_encrypted').notNull(),
    webhookSecretEncrypted: text('webhook_secret_encrypted').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('github_app_singleton', sql`${t.id} = 1`)],
);

export const githubInstalls = pgTable(
  'github_installs',
  {
    id: id(),
    installationId: bigint('installation_id', { mode: 'number' }).notNull(),
    settings: jsonb('settings').$type<GithubInstallSettings>().notNull(),
    backfillStatus: text('backfill_status').$type<'idle' | 'running' | 'done' | 'canceled' | 'failed'>().notNull().default('idle'),
    backfillProgress: real('backfill_progress').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    suspendedAt: ts('suspended_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [uniqueIndex('github_installs_installation_uq').on(t.installationId)],
);

export const githubLinks = pgTable(
  'github_links',
  {
    id: id(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'pr' | 'commit'>().notNull().default('pr'),
    repo: text('repo').notNull(),
    prNumber: integer('pr_number'),
    title: text('title'),
    prState: text('pr_state').$type<'open' | 'closed' | 'merged' | 'draft'>(),
    prUrl: text('pr_url'),
    author: text('author'),
    headBranch: text('head_branch'),
    commitSha: text('commit_sha'),
    /** Per-issue override of the mapping's auto_close_on_merge (null = inherit). */
    autoClose: boolean('auto_close'),
    closesIssue: boolean('closes_issue').notNull().default(false),
    mergedAt: ts('merged_at'),
    closedAt: ts('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('github_links_issue_idx').on(t.issueId),
    uniqueIndex('github_links_pr_uq').on(t.issueId, t.repo, t.prNumber).where(sql`${t.kind} = 'pr'`),
    uniqueIndex('github_links_commit_uq').on(t.issueId, t.repo, t.commitSha).where(sql`${t.kind} = 'commit'`),
  ],
);

export const githubEvents = pgTable(
  'github_events',
  {
    id: id(),
    installationId: bigint('installation_id', { mode: 'number' }),
    /** GitHub delivery id — unique, used for dedupe (SPEC §6.5). */
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    action: text('action'),
    payload: jsonb('payload').notNull(),
    status: text('status').$type<'pending' | 'processed' | 'ignored' | 'failed'>().notNull().default('pending'),
    error: text('error'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
  },
  (t) => [uniqueIndex('github_events_event_uq').on(t.eventId)],
);

// ───────────────────────────── Platform ─────────────────────────────

export const eventOutbox = pgTable(
  'event_outbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    publishedAt: ts('published_at'),
  },
  (t) => [
    index('event_outbox_created_brin').using('brin', t.createdAt),
    index('event_outbox_unpublished_idx').on(t.id).where(sql`${t.publishedAt} is null`),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorUserId: uuid('actor_user_id'),
    actorApiKeyId: uuid('actor_api_key_id'),
    actorMcpSessionId: uuid('actor_mcp_session_id'),
    action: text('action').notNull(),
    objectType: text('object_type'),
    objectId: text('object_id'),
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt), index('audit_log_action_idx').on(t.action)],
);

export type ImportRunStatus = 'mapping' | 'ready' | 'committing' | 'completed' | 'failed' | 'canceled';

export const importRuns = pgTable('import_runs', {
  id: id(),
  source: text('source').$type<ImportSource>().notNull(),
  status: text('status').$type<ImportRunStatus>().notNull().default('mapping'),
  fileName: text('file_name'),
  /** Parsed ImportBundle (normalized source data). */
  config: jsonb('config').notNull(),
  suggestedMapping: jsonb('suggested_mapping'),
  mapping: jsonb('mapping'),
  report: jsonb('report'),
  progress: real('progress').notNull().default(0),
  committedCount: integer('committed_count').notNull().default(0),
  error: text('error'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** external id → created entity, per run: makes chunked commits resumable & idempotent. */
export const importItems = pgTable(
  'import_items',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => importRuns.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    externalId: text('external_id').notNull(),
    entityId: uuid('entity_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.kind, t.externalId] })],
);

export const exports = pgTable('exports', {
  id: id(),
  status: text('status').$type<'pending' | 'running' | 'completed' | 'failed'>().notNull().default('pending'),
  filePath: text('file_path'),
  size: integer('size'),
  error: text('error'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
  completedAt: ts('completed_at'),
});
