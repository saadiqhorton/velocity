import { filter, map, pipe } from '@graphql-yoga/subscription';
import { GraphQLError } from 'graphql';
import type { ImportMapping } from '@velocity/schema';
import { builder } from '../builder';
import { requireActor, requireSessionActor } from '../errors';
import type { WorkspaceEventPayload } from '../pubsub';
import {
  DeliveryRef,
  ExportRef,
  GithubInstallRef,
  GithubLinkRef,
  ImportRunRef,
  ImportRunStatusEnum,
  ImportSourceEnum,
  IssueRef,
  NotificationPresetEnum,
  NotificationRef,
  NotificationTypeEnum,
  ProjectRef,
  SearchResultRef,
  SearchTypeEnum,
  TeamRef,
  UserRef,
  ViewRef,
  WebhookRef,
} from '../refs';

// ───────────── Notifications ─────────────

NotificationRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    type: t.field({ type: NotificationTypeEnum, resolve: (n) => n.type }),
    issueId: t.exposeID('issueId', { nullable: true }),
    issue: t.field({ type: IssueRef, nullable: true, resolve: (n, _a, ctx) => (n.issueId ? ctx.loaders.issue.load(n.issueId) : null) }),
    actor: t.field({ type: UserRef, nullable: true, resolve: (n, _a, ctx) => (n.actorUserId ? ctx.loaders.user.load(n.actorUserId) : null) }),
    payload: t.field({ type: 'JSON', resolve: (n) => n.payload }),
    readAt: t.expose('readAt', { type: 'DateTime', nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
  }),
});

// ───────────── Search ─────────────

SearchResultRef.implement({
  fields: (t) => ({
    type: t.field({ type: SearchTypeEnum, resolve: (h) => h.type }),
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    subtitle: t.exposeString('subtitle', { nullable: true }),
    rank: t.exposeFloat('rank'),
    issue: t.field({ type: IssueRef, nullable: true, resolve: (h, _a, ctx) => (h.type === 'issue' ? ctx.loaders.issue.load(h.id) : null) }),
    project: t.field({ type: ProjectRef, nullable: true, resolve: (h, _a, ctx) => (h.type === 'project' ? ctx.loaders.project.load(h.id) : null) }),
    team: t.field({ type: TeamRef, nullable: true, resolve: (h, _a, ctx) => (h.type === 'team' ? ctx.loaders.team.load(h.id) : null) }),
    user: t.field({ type: UserRef, nullable: true, resolve: (h, _a, ctx) => (h.type === 'member' ? ctx.loaders.user.load(h.id) : null) }),
    view: t.field({ type: ViewRef, nullable: true, resolve: (h, _a, ctx) => (h.type === 'view' ? ctx.loaders.view.load(h.id) : null) }),
  }),
});

// ───────────── Insights ─────────────

const WeekPointRef = builder.objectRef<{ weekStart: Date; created: number; completed: number }>('WeekPoint');
WeekPointRef.implement({
  fields: (t) => ({ weekStart: t.expose('weekStart', { type: 'DateTime' }), created: t.exposeInt('created'), completed: t.exposeInt('completed') }),
});
const TeamVelocityRef = builder.objectRef<{ teamId: string; key: string; name: string; cycles: { cycleId: string; number: number; completedPoints: number; completedCount: number; scopePoints: number }[] }>('TeamVelocity');
const TeamVelocityCycleRef = builder.objectRef<{ cycleId: string; number: number; completedPoints: number; completedCount: number; scopePoints: number }>('TeamVelocityCycle');
TeamVelocityCycleRef.implement({
  fields: (t) => ({
    cycleId: t.exposeID('cycleId'),
    number: t.exposeInt('number'),
    completedPoints: t.exposeInt('completedPoints'),
    completedCount: t.exposeInt('completedCount'),
    scopePoints: t.exposeInt('scopePoints'),
  }),
});
TeamVelocityRef.implement({
  fields: (t) => ({
    teamId: t.exposeID('teamId'),
    key: t.exposeString('key'),
    name: t.exposeString('name'),
    cycles: t.field({ type: [TeamVelocityCycleRef], resolve: (v) => v.cycles }),
  }),
});

// ───────────── Webhooks ─────────────

WebhookRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    url: t.exposeString('url'),
    description: t.exposeString('description', { nullable: true }),
    eventTypes: t.exposeStringList('eventTypes'),
    enabled: t.exposeBoolean('enabled'),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});

DeliveryRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    webhookId: t.exposeID('webhookId'),
    eventType: t.exposeString('eventType'),
    status: t.exposeString('status'),
    statusCode: t.exposeInt('statusCode', { nullable: true }),
    error: t.exposeString('error', { nullable: true }),
    attempt: t.exposeInt('attempt'),
    durationMs: t.exposeInt('durationMs', { nullable: true }),
    nextRetryAt: t.expose('nextRetryAt', { type: 'DateTime', nullable: true }),
    deliveredAt: t.expose('deliveredAt', { type: 'DateTime', nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    payload: t.field({ type: 'JSON', resolve: (d) => d.payload }),
  }),
});

const DeliveryPageRef = builder.objectRef<{ rows: import('@velocity/services').DeliveryRow[]; totalCount: number }>('WebhookDeliveryPage');
DeliveryPageRef.implement({
  fields: (t) => ({ nodes: t.field({ type: [DeliveryRef], resolve: (p) => p.rows }), totalCount: t.exposeInt('totalCount') }),
});

const CreatedWebhookRef = builder.objectRef<{ webhook: import('@velocity/services').WebhookRow; secret: string }>('CreatedWebhook');
CreatedWebhookRef.implement({
  fields: (t) => ({ webhook: t.field({ type: WebhookRef, resolve: (p) => p.webhook }), secret: t.exposeString('secret') }),
});

const WebhookInput = builder.inputType('WebhookInput', {
  fields: (t) => ({ url: t.string(), eventTypes: t.stringList(), description: t.string(), enabled: t.boolean() }),
});

// ───────────── GitHub ─────────────

GithubInstallRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    installationId: t.exposeInt('installationId'),
    accountLogin: t.string({ resolve: (i) => i.settings.accountLogin }),
    accountType: t.string({ resolve: (i) => i.settings.accountType }),
    repos: t.stringList({ resolve: (i) => i.settings.repos }),
    repoTeamMap: t.field({ type: 'JSON', resolve: (i) => i.settings.repoTeamMap }),
    autoCloseOnMerge: t.boolean({ resolve: (i) => i.settings.autoCloseOnMerge }),
    issueSync: t.boolean({ resolve: (i) => i.settings.issueSync }),
    issueSyncTeamId: t.id({ nullable: true, resolve: (i) => i.settings.issueSyncTeamId ?? null }),
    backfillStatus: t.exposeString('backfillStatus'),
    backfillProgress: t.exposeFloat('backfillProgress'),
    suspendedAt: t.expose('suspendedAt', { type: 'DateTime', nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
  }),
});

GithubLinkRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    kind: t.exposeString('kind'),
    repo: t.exposeString('repo'),
    prNumber: t.exposeInt('prNumber', { nullable: true }),
    title: t.exposeString('title', { nullable: true }),
    state: t.exposeString('prState', { nullable: true }),
    url: t.exposeString('prUrl', { nullable: true }),
    author: t.exposeString('author', { nullable: true }),
    headBranch: t.exposeString('headBranch', { nullable: true }),
    commitSha: t.exposeString('commitSha', { nullable: true }),
    closesIssue: t.exposeBoolean('closesIssue'),
    autoClose: t.exposeBoolean('autoClose', { nullable: true, description: 'Per-issue override; null inherits the install setting.' }),
    mergedAt: t.expose('mergedAt', { type: 'DateTime', nullable: true }),
    closedAt: t.expose('closedAt', { type: 'DateTime', nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});

const GithubIntegrationRef = builder.objectRef<{ configured: boolean; installUrl: string | null; installs: import('@velocity/services').GithubInstallRow[] }>('GithubIntegration');
GithubIntegrationRef.implement({
  fields: (t) => ({
    configured: t.exposeBoolean('configured', { description: 'GitHub App credentials are present in the environment.' }),
    installUrl: t.exposeString('installUrl', { nullable: true }),
    installs: t.field({ type: [GithubInstallRef], resolve: (g) => g.installs }),
  }),
});

const GithubSettingsInput = builder.inputType('GithubSettingsInput', {
  fields: (t) => ({ repoTeamMap: t.field({ type: 'JSON' }), autoCloseOnMerge: t.boolean(), issueSync: t.boolean(), issueSyncTeamId: t.id() }),
});

// ───────────── Import / export / audit ─────────────

ImportRunRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    source: t.field({ type: ImportSourceEnum, resolve: (r) => r.source }),
    status: t.field({ type: ImportRunStatusEnum, resolve: (r) => r.status }),
    fileName: t.exposeString('fileName', { nullable: true }),
    progress: t.exposeFloat('progress'),
    committedCount: t.exposeInt('committedCount'),
    error: t.exposeString('error', { nullable: true }),
    suggestedMapping: t.field({ type: 'JSON', nullable: true, resolve: (r) => r.suggestedMapping ?? null }),
    mapping: t.field({ type: 'JSON', nullable: true, resolve: (r) => r.mapping ?? null }),
    report: t.field({ type: 'JSON', nullable: true, resolve: (r) => r.report ?? null }),
    summary: t.field({
      type: 'JSON',
      description: 'Source overview for the mapping preview: teams, statuses, users, counts.',
      resolve: (r) => {
        const b = r.config as { teams?: unknown[]; statuses?: unknown[]; users?: unknown[]; labels?: unknown[]; issues?: unknown[]; projects?: unknown[]; cycles?: unknown[]; warnings?: unknown[] };
        return {
          teams: b.teams ?? [],
          statuses: b.statuses ?? [],
          users: b.users ?? [],
          counts: { issues: b.issues?.length ?? 0, labels: b.labels?.length ?? 0, projects: b.projects?.length ?? 0, cycles: b.cycles?.length ?? 0 },
          warnings: (b.warnings ?? []).slice(0, 200),
        };
      },
    }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});

const CreateImportRunInput = builder.inputType('CreateImportRunInput', {
  fields: (t) => ({ source: t.field({ type: ImportSourceEnum, required: true }), bundle: t.field({ type: 'JSON', required: true }), fileName: t.string() }),
});
const CsvImportInput = builder.inputType('CsvImportInput', {
  fields: (t) => ({
    source: t.field({ type: builder.enumType('CsvImportSource', { values: ['linear', 'jira'] as const }), required: true }),
    csv: t.string({ required: true }),
    fileName: t.string(),
  }),
});
const ApiImportInput = builder.inputType('ApiImportInput', {
  fields: (t) => ({
    source: t.field({ type: builder.enumType('ApiImportSource', { values: ['linear', 'github'] as const }), required: true }),
    apiKey: t.string({ description: 'Linear API key — used in memory only, never stored.' }),
    teamKeys: t.stringList(),
    token: t.string({ description: 'GitHub token — used in memory only, never stored.' }),
    repos: t.stringList(),
  }),
});

ExportRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    status: t.exposeString('status'),
    size: t.exposeInt('size', { nullable: true }),
    error: t.exposeString('error', { nullable: true }),
    downloadUrl: t.string({ nullable: true, resolve: (e) => (e.status === 'completed' ? `/api/exports/${e.id}/download` : null) }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    completedAt: t.expose('completedAt', { type: 'DateTime', nullable: true }),
  }),
});

interface AuditShape {
  id: number;
  actorUserId: string | null;
  actorApiKeyId: string | null;
  actorMcpSessionId: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  changes: Record<string, unknown> | null;
  ip: string | null;
  createdAt: Date;
}
const AuditEntryRef = builder.objectRef<AuditShape>('AuditEntry');
AuditEntryRef.implement({
  fields: (t) => ({
    id: t.id({ resolve: (e) => String(e.id) }),
    action: t.exposeString('action'),
    actor: t.field({ type: UserRef, nullable: true, resolve: (e, _a, ctx) => (e.actorUserId ? ctx.loaders.user.load(e.actorUserId) : null) }),
    actorApiKeyId: t.exposeID('actorApiKeyId', { nullable: true }),
    actorMcpSessionId: t.exposeID('actorMcpSessionId', { nullable: true }),
    objectType: t.exposeString('objectType', { nullable: true }),
    objectId: t.exposeString('objectId', { nullable: true }),
    changes: t.field({ type: 'JSON', nullable: true, resolve: (e) => e.changes }),
    ip: t.exposeString('ip', { nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
  }),
});
const AuditPageRef = builder.objectRef<{ entries: AuditShape[]; totalCount: number }>('AuditPage');
AuditPageRef.implement({ fields: (t) => ({ nodes: t.field({ type: [AuditEntryRef], resolve: (p) => p.entries }), totalCount: t.exposeInt('totalCount') }) });

const McpInfoRef = builder.objectRef<{ httpEnabled: boolean; httpEndpoint: string | null; stdioCommand: string; serverUrl: string }>('McpInfo');
McpInfoRef.implement({
  fields: (t) => ({
    httpEnabled: t.exposeBoolean('httpEnabled'),
    httpEndpoint: t.exposeString('httpEndpoint', { nullable: true }),
    stdioCommand: t.exposeString('stdioCommand'),
    serverUrl: t.exposeString('serverUrl'),
  }),
});

const WorkspaceEventRef = builder.objectRef<WorkspaceEventPayload>('WorkspaceEvent');
WorkspaceEventRef.implement({
  description: 'Invalidation signal for clients (SPEC §5.5): refetch what matches.',
  fields: (t) => ({
    topic: t.exposeString('topic'),
    issueId: t.exposeID('issueId', { nullable: true }),
    teamId: t.exposeID('teamId', { nullable: true }),
    projectId: t.exposeID('projectId', { nullable: true }),
    entityId: t.exposeID('entityId', { nullable: true }),
    changedFields: t.exposeStringList('changedFields'),
    actorUserId: t.exposeID('actorUserId', { nullable: true }),
  }),
});

// ───────────── Queries ─────────────

builder.queryFields((t) => ({
  notifications: t.field({
    type: [NotificationRef],
    args: { preset: t.arg({ type: NotificationPresetEnum }), first: t.arg.int() },
    resolve: (_r, a, ctx) => ctx.services.notifications.list(requireActor(ctx), { preset: a.preset, first: a.first }),
  }),
  unreadNotificationCount: t.int({ resolve: (_r, _a, ctx) => ctx.services.notifications.unreadCount(requireActor(ctx)) }),
  search: t.field({
    type: [SearchResultRef],
    args: { query: t.arg.string({ required: true }), types: t.arg({ type: [SearchTypeEnum] }), limit: t.arg.int(), teamId: t.arg.id() },
    resolve: (_r, a, ctx) => ctx.services.search.search(requireActor(ctx), a.query, { types: a.types, limit: a.limit, teamId: a.teamId }),
  }),
  createdVsCompleted: t.field({
    type: [WeekPointRef],
    args: { weeks: t.arg.int(), teamId: t.arg.id() },
    resolve: (_r, a, ctx) => ctx.services.insights.createdVsCompleted(requireActor(ctx), { weeks: a.weeks ?? 12, teamId: a.teamId }),
  }),
  velocityByTeam: t.field({
    type: [TeamVelocityRef],
    args: { cycles: t.arg.int() },
    resolve: (_r, a, ctx) => ctx.services.insights.velocityByTeam(requireActor(ctx), a.cycles ?? 6),
  }),
  webhooks: t.field({ type: [WebhookRef], resolve: (_r, _a, ctx) => ctx.services.webhooks.list(requireActor(ctx)) }),
  webhook: t.field({ type: WebhookRef, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => ctx.services.webhooks.get(requireActor(ctx), a.id) }),
  webhookDeliveries: t.field({
    type: DeliveryPageRef,
    args: { webhookId: t.arg.id({ required: true }), first: t.arg.int(), offset: t.arg.int() },
    resolve: (_r, a, ctx) => ctx.services.webhooks.deliveries(requireActor(ctx), a.webhookId, { limit: a.first ?? 25, offset: a.offset ?? 0 }),
  }),
  githubIntegration: t.field({
    type: GithubIntegrationRef,
    resolve: async (_r, _a, ctx) => {
      const actor = requireActor(ctx);
      const configured = ctx.services.github.isConfigured();
      return { configured, installUrl: ctx.services.github.installUrl(), installs: configured ? await ctx.services.github.installs(actor) : [] };
    },
  }),
  importRuns: t.field({ type: [ImportRunRef], resolve: (_r, _a, ctx) => ctx.services.importer.list(requireActor(ctx)) }),
  importRun: t.field({ type: ImportRunRef, nullable: true, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => ctx.services.importer.get(requireActor(ctx), a.id) }),
  exports: t.field({ type: [ExportRef], resolve: (_r, _a, ctx) => ctx.services.exports.list(requireActor(ctx)) }),
  auditLog: t.field({
    type: AuditPageRef,
    args: { action: t.arg.string(), actorUserId: t.arg.id(), first: t.arg.int(), offset: t.arg.int() },
    resolve: (_r, a, ctx) => ctx.services.audit.list(requireActor(ctx), { action: a.action, actorUserId: a.actorUserId, limit: a.first ?? 50, offset: a.offset ?? 0 }),
  }),
  mcpInfo: t.field({
    type: McpInfoRef,
    resolve: (_r, _a, ctx) => {
      requireActor(ctx);
      const cfg = ctx.services.deps.config;
      const base = cfg.appUrl.replace(/\/$/, '');
      return { httpEnabled: cfg.mcp.httpEnabled, httpEndpoint: cfg.mcp.httpEnabled ? `${base}/mcp` : null, stdioCommand: 'npx -y @velocity/mcp', serverUrl: base };
    },
  }),
}));

// ───────────── Mutations ─────────────

builder.mutationFields((t) => ({
  markNotificationsRead: t.field({
    type: [NotificationRef],
    args: { ids: t.arg.idList({ required: true }), read: t.arg.boolean({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.notifications.setRead(requireActor(ctx), a.ids, a.read),
  }),
  markAllNotificationsRead: t.int({ resolve: (_r, _a, ctx) => ctx.services.notifications.markAllRead(requireActor(ctx)) }),
  markIssueNotificationsRead: t.boolean({
    args: { issueId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.notifications.markReadForIssue(requireActor(ctx), a.issueId);
      return true;
    },
  }),
  deleteNotifications: t.boolean({
    args: { ids: t.arg.idList({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.notifications.delete(requireActor(ctx), a.ids);
      return true;
    },
  }),

  createWebhook: t.field({
    type: CreatedWebhookRef,
    args: { input: t.arg({ type: WebhookInput, required: true }) },
    resolve: (_r, { input }, ctx) => {
      if (!input.url || !input.eventTypes) throw new GraphQLError('URL and events are required.', { extensions: { code: 'VALIDATION' } });
      return ctx.services.webhooks.create(requireActor(ctx), { url: input.url, eventTypes: input.eventTypes, description: input.description, enabled: input.enabled });
    },
  }),
  updateWebhook: t.field({
    type: WebhookRef,
    args: { id: t.arg.id({ required: true }), input: t.arg({ type: WebhookInput, required: true }) },
    resolve: (_r, a, ctx) => ctx.services.webhooks.update(requireActor(ctx), a.id, a.input),
  }),
  deleteWebhook: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.webhooks.delete(requireActor(ctx), a.id);
      return true;
    },
  }),
  revealWebhookSecret: t.string({ args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => ctx.services.webhooks.revealSecret(requireSessionActor(ctx), a.id) }),
  rotateWebhookSecret: t.string({ args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => ctx.services.webhooks.rotateSecret(requireActor(ctx), a.id) }),
  testWebhook: t.field({ type: DeliveryRef, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => ctx.services.webhooks.test(requireActor(ctx), a.id) }),
  redeliverWebhook: t.field({
    type: DeliveryRef,
    args: { deliveryId: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.webhooks.redeliver(requireActor(ctx), a.deliveryId),
  }),

  githubCompleteInstall: t.field({
    type: GithubInstallRef,
    args: { installationId: t.arg.int({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.github.handleInstallCallback(requireSessionActor(ctx), a.installationId),
  }),
  updateGithubSettings: t.field({
    type: GithubInstallRef,
    args: { installId: t.arg.id({ required: true }), input: t.arg({ type: GithubSettingsInput, required: true }) },
    resolve: (_r, a, ctx) => {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a.input)) if (v !== undefined) patch[k] = v;
      return ctx.services.github.updateSettings(requireActor(ctx), a.installId, patch);
    },
  }),
  uninstallGithub: t.boolean({
    args: { installId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.github.uninstall(requireActor(ctx), a.installId);
      return true;
    },
  }),
  githubStartBackfill: t.boolean({
    args: { installId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.github.startBackfill(requireActor(ctx), a.installId);
      return true;
    },
  }),
  githubCancelBackfill: t.boolean({
    args: { installId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.github.cancelBackfill(requireActor(ctx), a.installId);
      return true;
    },
  }),
  linkPullRequest: t.field({
    type: GithubLinkRef,
    args: { issueId: t.arg.id({ required: true }), url: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.github.linkPullRequest(requireActor(ctx), a.issueId, a.url),
  }),
  unlinkGithub: t.boolean({
    args: { linkId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.github.unlink(requireActor(ctx), a.linkId);
      return true;
    },
  }),
  setGithubLinkAutoClose: t.field({
    type: GithubLinkRef,
    args: { linkId: t.arg.id({ required: true }), autoClose: t.arg.boolean() },
    resolve: (_r, a, ctx) => ctx.services.github.setAutoClose(requireActor(ctx), a.linkId, a.autoClose ?? null),
  }),

  createImportRun: t.field({
    type: ImportRunRef,
    description: 'Upload a pre-parsed ImportBundle (used by the velocity-import CLI).',
    args: { input: t.arg({ type: CreateImportRunInput, required: true }) },
    resolve: (_r, { input }, ctx) => ctx.services.importer.createRun(requireActor(ctx), { source: input.source, bundle: input.bundle as unknown, fileName: input.fileName }),
  }),
  createImportRunFromCsv: t.field({
    type: ImportRunRef,
    args: { input: t.arg({ type: CsvImportInput, required: true }) },
    resolve: (_r, { input }, ctx) => ctx.services.importer.createRunFromCsv(requireActor(ctx), input),
  }),
  createImportRunFromApi: t.field({
    type: ImportRunRef,
    args: { input: t.arg({ type: ApiImportInput, required: true }) },
    resolve: (_r, { input }, ctx) => {
      const actor = requireActor(ctx);
      if (input.source === 'linear') {
        if (!input.apiKey) throw new GraphQLError('Paste a Linear API key.', { extensions: { code: 'VALIDATION', field: 'apiKey' } });
        return ctx.services.importer.createRunFromApi(actor, { source: 'linear', apiKey: input.apiKey, teamKeys: input.teamKeys });
      }
      if (!input.token || !input.repos?.length) throw new GraphQLError('A GitHub token and at least one repository are required.', { extensions: { code: 'VALIDATION' } });
      return ctx.services.importer.createRunFromApi(actor, { source: 'github', token: input.token, repos: input.repos });
    },
  }),
  updateImportMapping: t.field({
    type: ImportRunRef,
    args: { id: t.arg.id({ required: true }), mapping: t.arg({ type: 'JSON', required: true }) },
    resolve: (_r, a, ctx) => ctx.services.importer.updateMapping(requireActor(ctx), a.id, a.mapping as ImportMapping),
  }),
  dryRunImport: t.field({ type: ImportRunRef, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => ctx.services.importer.dryRun(requireActor(ctx), a.id) }),
  commitImport: t.field({ type: ImportRunRef, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => ctx.services.importer.commit(requireActor(ctx), a.id) }),
  cancelImport: t.field({ type: ImportRunRef, args: { id: t.arg.id({ required: true }) }, resolve: (_r, a, ctx) => ctx.services.importer.cancel(requireActor(ctx), a.id) }),
  requestExport: t.field({ type: ExportRef, resolve: (_r, _a, ctx) => ctx.services.exports.request(requireActor(ctx)) }),

  startMcpSession: t.id({
    description: 'Called by MCP servers on connect; returns the session id sent as X-MCP-Session-Id (audited).',
    args: { clientName: t.arg.string(), transport: t.arg.string() },
    resolve: (_r, a, ctx) => ctx.services.auth.startMcpSession(requireActor(ctx), { clientName: a.clientName, transport: a.transport === 'http' ? 'http' : 'stdio' }),
  }),
}));

// ───────────── Subscriptions (graphql-ws, SPEC §6.1.1) ─────────────

builder.subscriptionFields((t) => ({
  issueUpdated: t.field({
    type: IssueRef,
    nullable: true,
    args: { issueId: t.arg.id() },
    subscribe: (_r, a, ctx) => {
      requireActor(ctx);
      if (a.issueId) return ctx.pubsub.subscribe('issue:updated', a.issueId);
      return pipe(
        ctx.pubsub.subscribe('workspace:event'),
        filter((e: WorkspaceEventPayload) => Boolean(e.issueId) && e.topic.startsWith('issue.')),
        map((e: WorkspaceEventPayload) => ({ issueId: e.issueId! })),
      );
    },
    resolve: (p: { issueId: string }, _a, ctx) => ctx.services.issues.get(p.issueId),
  }),
  issueCreated: t.field({
    type: IssueRef,
    nullable: true,
    args: { teamId: t.arg.id() },
    subscribe: (_r, a, ctx) => {
      requireActor(ctx);
      return pipe(
        ctx.pubsub.subscribe('issue:created'),
        filter((p: { issueId: string; teamId: string }) => !a.teamId || p.teamId === a.teamId),
      );
    },
    resolve: (p: { issueId: string }, _a, ctx) => ctx.services.issues.get(p.issueId),
  }),
  notificationCreated: t.field({
    type: NotificationRef,
    nullable: true,
    subscribe: (_r, _a, ctx) => ctx.pubsub.subscribe('notification:created', requireActor(ctx).userId),
    resolve: async (p: { notificationId: string }, _a, ctx) => {
      const rows = await ctx.services.notifications.list(requireActor(ctx), { first: 50 });
      return rows.find((n) => n.id === p.notificationId) ?? null;
    },
  }),
  importProgress: t.field({
    type: ImportRunRef,
    nullable: true,
    args: { runId: t.arg.id({ required: true }) },
    subscribe: (_r, a, ctx) => {
      requireActor(ctx);
      return ctx.pubsub.subscribe('import:progress', a.runId);
    },
    resolve: (p: { runId: string }, _a, ctx) => ctx.services.importer.get(requireActor(ctx), p.runId),
  }),
  workspaceEvents: t.field({
    type: WorkspaceEventRef,
    subscribe: (_r, _a, ctx) => {
      requireActor(ctx);
      return ctx.pubsub.subscribe('workspace:event');
    },
    resolve: (p: WorkspaceEventPayload) => p,
  }),
}));
