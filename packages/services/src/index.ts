import type { ServiceDeps } from './context';
import { ApiKeyService } from './api-keys';
import { AttachmentService } from './attachments';
import { AuditService } from './audit';
import { AuthService } from './auth';
import { CommentService } from './comments';
import { CycleService } from './cycles';
import { EventProcessor } from './event-handlers';
import { ExportService } from './exports';
import { GitHubService } from './github';
import { ImporterService } from './importer';
import { InsightsService } from './insights';
import { IssueService } from './issues';
import { LabelService } from './labels';
import { MaintenanceService } from './maintenance';
import { NotificationService } from './notifications';
import { ProjectService } from './projects';
import { SearchService } from './search';
import { TeamService } from './teams';
import { UserService } from './users';
import { ViewService } from './views';
import { WebhookService } from './webhooks';
import { WorkspaceService } from './workspace';

export interface Services {
  deps: ServiceDeps;
  audit: AuditService;
  auth: AuthService;
  users: UserService;
  apiKeys: ApiKeyService;
  workspace: WorkspaceService;
  teams: TeamService;
  labels: LabelService;
  issues: IssueService;
  comments: CommentService;
  cycles: CycleService;
  projects: ProjectService;
  views: ViewService;
  notifications: NotificationService;
  search: SearchService;
  insights: InsightsService;
  webhooks: WebhookService;
  attachments: AttachmentService;
  exports: ExportService;
  importer: ImporterService;
  github: GitHubService;
  maintenance: MaintenanceService;
  events: EventProcessor;
}

/** Wires every domain service (SPEC §5.3: all domain mutations happen here). */
export function createServices(deps: ServiceDeps): Services {
  const s: Services = {
    deps,
    audit: new AuditService(deps),
    auth: new AuthService(deps),
    users: new UserService(deps),
    apiKeys: new ApiKeyService(deps),
    workspace: new WorkspaceService(deps),
    teams: new TeamService(deps),
    labels: new LabelService(deps),
    issues: new IssueService(deps),
    comments: new CommentService(deps),
    cycles: new CycleService(deps),
    projects: new ProjectService(deps),
    views: new ViewService(deps),
    notifications: new NotificationService(deps),
    search: new SearchService(deps),
    insights: new InsightsService(deps),
    webhooks: new WebhookService(deps),
    attachments: new AttachmentService(deps),
    exports: new ExportService(deps),
    importer: new ImporterService(deps),
    github: new GitHubService(deps),
    maintenance: new MaintenanceService(deps),
    events: new EventProcessor(deps),
  };
  s.auth.bind(s.audit);
  s.users.bind(s.audit, s.auth);
  s.apiKeys.bind(s.audit, s.auth);
  s.workspace.bind(s.audit);
  s.teams.bind(s.audit, s.issues);
  s.issues.bind(s.teams, s.audit);
  s.cycles.bind(s.issues, s.audit);
  s.projects.bind(s.audit);
  s.webhooks.bind(s.audit);
  s.exports.bind(s.audit);
  s.importer.bind({ audit: s.audit, issues: s.issues, teams: s.teams, labels: s.labels, comments: s.comments });
  s.github.bind({ audit: s.audit, issues: s.issues, teams: s.teams, comments: s.comments });
  s.maintenance.bind(s.issues, s.webhooks);
  s.events.bind(s.notifications, s.webhooks);
  return s;
}

export * from './context';
export * from './errors';
export * from './db';
export * from './jobs';
export * from './storage';
export { memberActor, hashSecret, verifySecret, validateUsername } from './auth';
export type { IssuedSession, ClientInfo } from './auth';
export type { IssueRow, IssuePatch, IssueCreateInput, IssueListArgs, RelationRow, GroupBy } from './issues';
export { compileFilter } from './issues';
export type { TeamRow, StatusRow, TeamInput } from './teams';
export { CATEGORY_RANK, DEFAULT_STATUSES } from './teams';
export type { LabelRow } from './labels';
export type { CommentRow, ReactionRow } from './comments';
export { REACTION_EMOJI } from './comments';
export type { CycleRow, CycleLiveStats } from './cycles';
export type { ProjectRow, MilestoneRow, ProjectInput } from './projects';
export type { ViewRow, FavoriteRow } from './views';
export { DEFAULT_DISPLAY, normalizeDisplay } from './views';
export type { NotificationRow } from './notifications';
export type { SearchHit, SearchType } from './search';
export type { WebhookRow, DeliveryRow } from './webhooks';
export type { AttachmentRow } from './attachments';
export { INLINE_MIME } from './attachments';
export type { ExportRow } from './exports';
export type { ImportRunRow } from './importer';
export type { GithubInstallRow, GithubLinkRow, WebhookReceipt } from './github';
export type { UserRow } from './users';
export type { WorkspaceRow } from './workspace';
export type { AuditAction } from './audit';
export type { Action, Actor } from './lib/permissions';
export { can, assertCan, ForbiddenError, PERMISSION_TABLE } from './lib/permissions';
