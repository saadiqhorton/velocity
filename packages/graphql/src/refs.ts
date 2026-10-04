import type {
  ApiKeyScope,
  CycleStats,
  ImportSource,
  MilestoneStatus,
  NotificationType,
  PaletteColor,
  ProjectHealth,
  ProjectStatus,
  StatusCategory,
  ViewDisplay,
} from '@velocity/schema';
import {
  API_KEY_SCOPES,
  CARRY_OVER,
  IMPORT_SOURCES,
  MILESTONE_STATUSES,
  NOTIFICATION_TYPES,
  PALETTE_COLORS,
  PROJECT_HEALTH,
  PROJECT_STATUSES,
  STATUS_CATEGORIES,
  VIEW_GROUPINGS,
  VIEW_LAYOUTS,
  VIEW_ORDERINGS,
  WEBHOOK_EVENT_TYPES,
} from '@velocity/schema';
import type {
  AttachmentRow,
  CommentRow,
  CycleLiveStats,
  CycleRow,
  DeliveryRow,
  ExportRow,
  FavoriteRow,
  GithubInstallRow,
  GithubLinkRow,
  ImportRunRow,
  IssueRow,
  LabelRow,
  MilestoneRow,
  NotificationRow,
  ProjectRow,
  SearchHit,
  StatusRow,
  TeamRow,
  UserRow,
  ViewRow,
  WebhookRow,
  WorkspaceRow,
} from '@velocity/services';
import { builder } from './builder';

// ───────────── Enums ─────────────
export const StatusCategoryEnum = builder.enumType('StatusCategory', { values: STATUS_CATEGORIES });
export const PaletteColorEnum = builder.enumType('PaletteColor', { values: PALETTE_COLORS });
export const ProjectStatusEnum = builder.enumType('ProjectStatus', { values: PROJECT_STATUSES });
export const ProjectHealthEnum = builder.enumType('ProjectHealth', { values: PROJECT_HEALTH });
export const MilestoneStatusEnum = builder.enumType('MilestoneStatus', { values: MILESTONE_STATUSES });
export const ApiKeyScopeEnum = builder.enumType('ApiKeyScope', { values: API_KEY_SCOPES });
export const CarryOverEnum = builder.enumType('CarryOver', { values: CARRY_OVER });
export const ImportSourceEnum = builder.enumType('ImportSource', { values: IMPORT_SOURCES });
export const NotificationTypeEnum = builder.enumType('NotificationType', { values: NOTIFICATION_TYPES });
export const GroupByEnum = builder.enumType('GroupBy', { values: VIEW_GROUPINGS });
export const OrderingEnum = builder.enumType('Ordering', { values: VIEW_ORDERINGS });
export const LayoutEnum = builder.enumType('Layout', { values: VIEW_LAYOUTS });
export const ThemeEnum = builder.enumType('Theme', { values: ['dark', 'light', 'system'] as const });
export const EstimateScaleEnum = builder.enumType('EstimateScale', { values: ['linear', 'fibonacci', 'exponential', 'tshirt'] as const });
export const RelationTypeEnum = builder.enumType('RelationType', {
  description: '`blocked_by` is the derived inverse of `blocks` (stored once).',
  values: ['blocks', 'blocked_by', 'related', 'duplicate', 'duplicated_by'] as const,
});
export const RelationInputTypeEnum = builder.enumType('RelationInputType', { values: ['blocks', 'blocked_by', 'related', 'duplicate'] as const });
export const SearchTypeEnum = builder.enumType('SearchType', { values: ['issue', 'project', 'team', 'member', 'view'] as const });
export const FavoriteKindEnum = builder.enumType('FavoriteKind', { values: ['view', 'project', 'team', 'issue', 'cycle'] as const });
export const WebhookEventTypeEnum = builder.enumType('WebhookEventType', {
  values: Object.fromEntries(WEBHOOK_EVENT_TYPES.map((e) => [e.replace('.', '_').toUpperCase(), { value: e }])) as Record<string, { value: string }>,
});
export const ImportRunStatusEnum = builder.enumType('ImportRunStatus', { values: ['mapping', 'ready', 'committing', 'completed', 'failed', 'canceled'] as const });
export const NotificationPresetEnum = builder.enumType('NotificationPreset', { values: ['all', 'assigned', 'subscribed', 'unread'] as const });

// ───────────── Object refs (implemented in ./types/*) ─────────────
export const UserRef = builder.objectRef<UserRow>('User');
export const WorkspaceRef = builder.objectRef<WorkspaceRow>('Workspace');
export const TeamRef = builder.objectRef<TeamRow>('Team');
export const StatusRef = builder.objectRef<StatusRow>('WorkflowStatus');
export const LabelRef = builder.objectRef<LabelRow>('Label');
export const IssueRef = builder.objectRef<IssueRow>('Issue');
export const CommentRef = builder.objectRef<CommentRow>('Comment');
export const CycleRef = builder.objectRef<CycleRow>('Cycle');
export const ProjectRef = builder.objectRef<ProjectRow>('Project');
export const MilestoneRef = builder.objectRef<MilestoneRow>('Milestone');
export const ViewRef = builder.objectRef<ViewRow>('View');
export const FavoriteRef = builder.objectRef<FavoriteRow>('Favorite');
export const NotificationRef = builder.objectRef<NotificationRow>('Notification');
export const AttachmentRef = builder.objectRef<AttachmentRow>('Attachment');
export const WebhookRef = builder.objectRef<WebhookRow>('Webhook');
export const DeliveryRef = builder.objectRef<DeliveryRow>('WebhookDelivery');
export const GithubInstallRef = builder.objectRef<GithubInstallRow>('GithubInstall');
export const GithubLinkRef = builder.objectRef<GithubLinkRow>('GithubLink');
export const ImportRunRef = builder.objectRef<ImportRunRow>('ImportRun');
export const ExportRef = builder.objectRef<ExportRow>('Export');
export const SearchResultRef = builder.objectRef<SearchHit>('SearchResult');

export interface IssueRelationShape {
  id: string;
  type: 'blocks' | 'blocked_by' | 'related' | 'duplicate' | 'duplicated_by';
  issueId: string;
  createdAt: Date;
}
export const IssueRelationRef = builder.objectRef<IssueRelationShape>('IssueRelation');

export type CycleStatsShape = CycleStats;
export const CycleStatsRef = builder.objectRef<CycleStats>('CycleStats');
export const CycleLiveStatsRef = builder.objectRef<CycleLiveStats>('CycleLiveStats');
export const ViewDisplayRef = builder.objectRef<ViewDisplay>('ViewDisplay');

export interface ProgressShape {
  done: number;
  total: number;
  pointsDone: number;
  pointsTotal: number;
}
export const ProgressRef = builder.objectRef<ProgressShape>('Progress');

export interface PageInfoShape {
  hasNextPage: boolean;
  endCursor: string | null;
}
export const PageInfoRef = builder.objectRef<PageInfoShape>('PageInfo');
PageInfoRef.implement({
  fields: (t) => ({
    hasNextPage: t.exposeBoolean('hasNextPage'),
    endCursor: t.exposeString('endCursor', { nullable: true }),
  }),
});

ProgressRef.implement({
  fields: (t) => ({
    done: t.exposeInt('done'),
    total: t.exposeInt('total'),
    pointsDone: t.exposeInt('pointsDone'),
    pointsTotal: t.exposeInt('pointsTotal'),
    percent: t.float({ resolve: (p) => (p.total ? Math.round((p.done / p.total) * 1000) / 10 : 0) }),
  }),
});

/** Opaque offset cursors (SPEC §6.1.1 cursor pagination). */
export function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`).toString('base64url');
}
export function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const s = Buffer.from(cursor, 'base64url').toString('utf8');
  const m = /^o:(\d+)$/.exec(s);
  return m ? Number(m[1]) : 0;
}

export type { ApiKeyScope, ImportSource, MilestoneStatus, NotificationType, PaletteColor, ProjectHealth, ProjectStatus, StatusCategory };
