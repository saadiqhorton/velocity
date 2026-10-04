import { GraphQLError } from 'graphql';
import { builder } from '../builder';
import { requireActor, requireSessionActor } from '../errors';
import {
  ApiKeyScopeEnum,
  CarryOverEnum,
  CycleRef,
  EstimateScaleEnum,
  LabelRef,
  PaletteColorEnum,
  StatusCategoryEnum,
  StatusRef,
  TeamRef,
  ThemeEnum,
  UserRef,
  WorkspaceRef,
} from '../refs';
import type { GqlContext } from '../context';

// ───────────── Object types ─────────────

UserRef.implement({
  description: 'A workspace member. Every member is a peer; the owner can administer the workspace (SPEC §3.2.3).',
  fields: (t) => ({
    id: t.exposeID('id'),
    username: t.exposeString('username'),
    name: t.exposeString('name'),
    email: t.exposeString('email', { nullable: true }),
    avatarUrl: t.string({ nullable: true, resolve: (u) => (u.avatarPath ? `/avatars/${u.id}?v=${encodeURIComponent(u.updatedAt.getTime().toString(36))}` : null) }),
    isOwner: t.exposeBoolean('isOwner'),
    isMe: t.boolean({ resolve: (u, _a, ctx) => u.id === ctx.actor?.userId }),
    suspended: t.boolean({ resolve: (u) => Boolean(u.suspendedAt) }),
    removed: t.boolean({ resolve: (u) => Boolean(u.deletedAt) }),
    timezone: t.exposeString('timezone'),
    locale: t.exposeString('locale'),
    theme: t.field({ type: ThemeEnum, resolve: (u, _a, ctx) => (u.id === ctx.actor?.userId ? u.theme : 'system') }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
  }),
});

WorkspaceRef.implement({
  fields: (t) => ({
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    timezone: t.exposeString('timezone'),
    locale: t.exposeString('locale'),
    setupCompleted: t.boolean({ resolve: (w) => Boolean(w.setupCompletedAt) }),
    deletionRequestedAt: t.expose('deletionRequestedAt', { type: 'DateTime', nullable: true }),
    deletionScheduledFor: t.field({
      type: 'DateTime',
      nullable: true,
      resolve: (w) => (w.deletionRequestedAt ? new Date(w.deletionRequestedAt.getTime() + 7 * 86_400_000) : null),
    }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
  }),
});

TeamRef.implement({
  description: 'Teams are categories for work with their own issue prefix (SPEC §3.4).',
  fields: (t) => ({
    id: t.exposeID('id'),
    key: t.exposeString('key'),
    name: t.exposeString('name'),
    icon: t.exposeString('icon', { nullable: true }),
    color: t.field({ type: PaletteColorEnum, resolve: (x) => x.color }),
    description: t.exposeString('description', { nullable: true }),
    cycleEnabled: t.exposeBoolean('cycleEnabled'),
    cycleLengthWeeks: t.exposeInt('cycleLengthWeeks'),
    cycleStartDay: t.exposeInt('cycleStartDay', { description: '0 = Sunday … 6 = Saturday' }),
    cycleTimezone: t.exposeString('cycleTimezone'),
    carryOver: t.field({ type: CarryOverEnum, resolve: (x) => x.carryOver }),
    estimateScale: t.field({ type: EstimateScaleEnum, resolve: (x) => x.estimateScale }),
    sortOrder: t.exposeFloat('sortOrder'),
    archivedAt: t.expose('archivedAt', { type: 'DateTime', nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    statuses: t.field({ type: [StatusRef], resolve: (x, _a, ctx) => ctx.loaders.teamStatuses.load(x.id) }),
    members: t.field({ type: [UserRef], resolve: (x, _a, ctx) => ctx.services.teams.members(x.id) }),
    openIssueCount: t.int({
      resolve: async (x, _a, ctx) => (await ctx.services.issues.countByTeam()).find((r) => r.teamId === x.id)?.open ?? 0,
    }),
    activeCycle: t.field({ type: CycleRef, nullable: true, resolve: (x, _a, ctx) => (x.cycleEnabled ? ctx.services.cycles.current(x.id) : null) }),
    upcomingCycles: t.field({ type: [CycleRef], resolve: (x, _a, ctx) => (x.cycleEnabled ? ctx.services.cycles.upcoming(x.id) : []) }),
    cycles: t.field({
      type: [CycleRef],
      args: { includeClosed: t.arg.boolean(), first: t.arg.int() },
      resolve: (x, a, ctx) => ctx.services.cycles.list(x.id, { includeClosed: a.includeClosed ?? true, limit: a.first ?? 100 }),
    }),
  }),
});

StatusRef.implement({
  description: 'A workflow status; category drives behavior (SPEC §3.6).',
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    category: t.field({ type: StatusCategoryEnum, resolve: (s) => s.category }),
    color: t.field({ type: PaletteColorEnum, resolve: (s) => s.color }),
    order: t.exposeFloat('order'),
    description: t.exposeString('description', { nullable: true }),
    teamId: t.exposeID('teamId'),
    team: t.field({ type: TeamRef, nullable: true, resolve: (s, _a, ctx) => ctx.loaders.team.load(s.teamId) }),
  }),
});

LabelRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    color: t.field({ type: PaletteColorEnum, resolve: (l) => l.color }),
    description: t.exposeString('description', { nullable: true }),
    isGroup: t.exposeBoolean('isGroup'),
    parentId: t.exposeID('parentId', { nullable: true }),
    parent: t.field({ type: LabelRef, nullable: true, resolve: (l, _a, ctx) => (l.parentId ? ctx.loaders.label.load(l.parentId) : null) }),
  }),
});

// ───────────── Auth / setup payloads ─────────────

const SetupStatusRef = builder.objectRef<{ needsSetup: boolean; workspaceName: string | null; setupCompleted: boolean; signupEnabled: boolean }>('SetupStatus');
SetupStatusRef.implement({
  fields: (t) => ({
    needsSetup: t.exposeBoolean('needsSetup'),
    setupCompleted: t.exposeBoolean('setupCompleted'),
    signupEnabled: t.exposeBoolean('signupEnabled'),
    workspaceName: t.exposeString('workspaceName', { nullable: true }),
  }),
});

const AuthPayloadRef = builder.objectRef<{ user: import('@velocity/services').UserRow; csrfToken: string; expiresAt: Date }>('AuthPayload');
AuthPayloadRef.implement({
  fields: (t) => ({
    user: t.field({ type: UserRef, resolve: (p) => p.user }),
    csrfToken: t.exposeString('csrfToken', { description: 'Echo in the X-CSRF-Token header on cookie-authenticated requests.' }),
    expiresAt: t.expose('expiresAt', { type: 'DateTime' }),
  }),
});

const InviteInfoRef = builder.objectRef<{ valid: boolean; name: string | null; workspaceName: string | null }>('InviteInfo');
InviteInfoRef.implement({
  fields: (t) => ({
    valid: t.exposeBoolean('valid'),
    name: t.exposeString('name', { nullable: true }),
    workspaceName: t.exposeString('workspaceName', { nullable: true }),
  }),
});

const InviteRef = builder.objectRef<{ id: string; name: string | null; createdAt: Date; expiresAt: Date; url?: string | null }>('Invite');
InviteRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name', { nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    expiresAt: t.expose('expiresAt', { type: 'DateTime' }),
    url: t.string({ nullable: true, description: 'Only returned when the invite is created.', resolve: (i) => i.url ?? null }),
  }),
});

const SessionRef = builder.objectRef<{ id: string; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date; ip: string | null; userAgent: string | null }>('Session');
SessionRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    lastUsedAt: t.expose('lastUsedAt', { type: 'DateTime', nullable: true }),
    expiresAt: t.expose('expiresAt', { type: 'DateTime' }),
    ip: t.exposeString('ip', { nullable: true }),
    userAgent: t.exposeString('userAgent', { nullable: true }),
    current: t.boolean({ resolve: (s, _a, ctx) => s.id === ctx.sessionId }),
  }),
});

interface ApiKeyShape {
  id: string;
  userId: string;
  userName: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write';
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}
const ApiKeyRef = builder.objectRef<ApiKeyShape>('ApiKey');
ApiKeyRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    prefix: t.exposeString('prefix', { description: 'Display form, e.g. vel_ab12cd34…' }),
    scope: t.field({ type: ApiKeyScopeEnum, resolve: (k) => k.scope }),
    lastUsedAt: t.expose('lastUsedAt', { type: 'DateTime', nullable: true }),
    expiresAt: t.expose('expiresAt', { type: 'DateTime', nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    user: t.field({ type: UserRef, nullable: true, resolve: (k, _a, ctx) => ctx.loaders.user.load(k.userId) }),
    mutationsPerHour: t.field({
      type: [builder.objectRef<{ hour: Date; count: number }>('HourlyCount').implement({
        fields: (u) => ({ hour: u.expose('hour', { type: 'DateTime' }), count: u.exposeInt('count') }),
      })],
      description: 'Last 24h of mutations made with this key (runaway-agent detection, SPEC §7.1.6).',
      resolve: (k, _a, ctx) => ctx.services.apiKeys.activity(requireActor(ctx), k.id),
    }),
  }),
});

const CreatedApiKeyRef = builder.objectRef<{ apiKey: ApiKeyShape; plaintext: string }>('CreatedApiKey');
CreatedApiKeyRef.implement({
  fields: (t) => ({
    apiKey: t.field({ type: ApiKeyRef, resolve: (p) => p.apiKey }),
    plaintext: t.exposeString('plaintext', { description: 'Shown once. Store it now.' }),
  }),
});

// ───────────── Inputs ─────────────

const SetupInput = builder.inputType('SetupWorkspaceInput', {
  fields: (t) => ({
    workspaceName: t.string({ required: true }),
    username: t.string({ required: true }),
    password: t.string({ required: true }),
    name: t.string(),
    email: t.string(),
  }),
});
const LoginInput = builder.inputType('LoginInput', {
  fields: (t) => ({ login: t.string({ required: true }), password: t.string({ required: true }), remember: t.boolean() }),
});
const AcceptInviteInput = builder.inputType('AcceptInviteInput', {
  fields: (t) => ({
    token: t.string({ required: true }),
    username: t.string({ required: true }),
    password: t.string({ required: true }),
    name: t.string(),
    email: t.string(),
  }),
});
const SignupInput = builder.inputType('SignupInput', {
  fields: (t) => ({ username: t.string({ required: true }), password: t.string({ required: true }), name: t.string(), email: t.string() }),
});
const ProfileInput = builder.inputType('UpdateProfileInput', {
  fields: (t) => ({ name: t.string(), email: t.string(), username: t.string(), timezone: t.string(), locale: t.string(), theme: t.field({ type: ThemeEnum }) }),
});
const WorkspaceInput = builder.inputType('UpdateWorkspaceInput', {
  fields: (t) => ({ name: t.string(), slug: t.string(), timezone: t.string(), locale: t.string() }),
});
const TeamCreateInput = builder.inputType('CreateTeamInput', {
  fields: (t) => ({
    key: t.string({ required: true }),
    name: t.string({ required: true }),
    icon: t.string(),
    color: t.field({ type: PaletteColorEnum }),
    description: t.string(),
    cycleEnabled: t.boolean(),
    cycleLengthWeeks: t.int(),
    cycleStartDay: t.int(),
    cycleTimezone: t.string(),
    carryOver: t.field({ type: CarryOverEnum }),
    estimateScale: t.field({ type: EstimateScaleEnum }),
  }),
});
const TeamUpdateInput = builder.inputType('UpdateTeamInput', {
  fields: (t) => ({
    key: t.string(),
    name: t.string(),
    icon: t.string(),
    color: t.field({ type: PaletteColorEnum }),
    description: t.string(),
    cycleEnabled: t.boolean(),
    cycleLengthWeeks: t.int(),
    cycleStartDay: t.int(),
    cycleTimezone: t.string(),
    carryOver: t.field({ type: CarryOverEnum }),
    estimateScale: t.field({ type: EstimateScaleEnum }),
  }),
});
const StatusCreateInput = builder.inputType('CreateStatusInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    category: t.field({ type: StatusCategoryEnum, required: true }),
    color: t.field({ type: PaletteColorEnum, required: true }),
    description: t.string(),
  }),
});
const StatusUpdateInput = builder.inputType('UpdateStatusInput', {
  fields: (t) => ({ name: t.string(), category: t.field({ type: StatusCategoryEnum }), color: t.field({ type: PaletteColorEnum }), description: t.string() }),
});
const LabelCreateInput = builder.inputType('CreateLabelInput', {
  fields: (t) => ({ name: t.string({ required: true }), color: t.field({ type: PaletteColorEnum }), description: t.string(), parentId: t.id(), isGroup: t.boolean() }),
});
const LabelUpdateInput = builder.inputType('UpdateLabelInput', {
  fields: (t) => ({ name: t.string(), color: t.field({ type: PaletteColorEnum }), description: t.string(), parentId: t.id() }),
});

function client(ctx: GqlContext) {
  return { ip: ctx.request.ip, userAgent: ctx.request.userAgent };
}

// ───────────── Queries ─────────────

builder.queryFields((t) => ({
  setupStatus: t.field({ type: SetupStatusRef, resolve: (_r, _a, ctx) => ctx.services.auth.setupStatus() }),
  viewer: t.field({
    type: UserRef,
    nullable: true,
    description: 'The authenticated member, or null.',
    resolve: (_r, _a, ctx) => (ctx.actor?.userId ? ctx.loaders.user.load(ctx.actor.userId) : null),
  }),
  workspace: t.field({
    type: WorkspaceRef,
    nullable: true,
    resolve: (_r, _a, ctx) => {
      requireActor(ctx);
      return ctx.services.workspace.get();
    },
  }),
  users: t.field({
    type: [UserRef],
    args: { includeSuspended: t.arg.boolean() },
    resolve: (_r, a, ctx) => ctx.services.users.list(requireActor(ctx), { includeSuspended: a.includeSuspended ?? false }),
  }),
  user: t.field({
    type: UserRef,
    nullable: true,
    args: { id: t.arg.id(), username: t.arg.string() },
    resolve: (_r, a, ctx) => {
      requireActor(ctx);
      if (a.id) return ctx.loaders.user.load(a.id);
      if (a.username) return ctx.services.users.byUsername(a.username === 'me' ? '' : a.username);
      return null;
    },
  }),
  teams: t.field({
    type: [TeamRef],
    args: { includeArchived: t.arg.boolean() },
    resolve: (_r, a, ctx) => ctx.services.teams.list(requireActor(ctx), { includeArchived: a.includeArchived ?? false }),
  }),
  team: t.field({
    type: TeamRef,
    nullable: true,
    args: { id: t.arg.id(), key: t.arg.string() },
    resolve: (_r, a, ctx) => {
      requireActor(ctx);
      if (a.id) return ctx.services.teams.get(a.id);
      if (a.key) return ctx.services.teams.getByKey(a.key);
      return null;
    },
  }),
  labels: t.field({
    type: [LabelRef],
    resolve: (_r, _a, ctx) => {
      requireActor(ctx);
      return ctx.services.labels.list();
    },
  }),
  inviteInfo: t.field({ type: InviteInfoRef, args: { token: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => ctx.services.auth.inviteInfo(a.token) }),
  invites: t.field({ type: [InviteRef], resolve: (_r, _a, ctx) => ctx.services.auth.listInvites(requireActor(ctx)) }),
  sessions: t.field({ type: [SessionRef], resolve: (_r, _a, ctx) => ctx.services.auth.listSessions(requireSessionActor(ctx)) }),
  apiKeys: t.field({
    type: [ApiKeyRef],
    args: { all: t.arg.boolean({ description: 'Owner only: every member’s keys.' }) },
    resolve: (_r, a, ctx) => ctx.services.apiKeys.list(requireActor(ctx), { all: a.all ?? false }),
  }),
}));

// ───────────── Mutations ─────────────

builder.mutationFields((t) => ({
  setupWorkspace: t.field({
    type: AuthPayloadRef,
    description: 'First-run wizard: create the workspace and its owner (only while no user exists).',
    args: { input: t.arg({ type: SetupInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      const s = await ctx.services.auth.setupWorkspace(input, client(ctx));
      await ctx.services.labels.ensureDefaults();
      ctx.request.setSession(s.token, s.csrfToken, s.expiresAt);
      return { user: s.user, csrfToken: s.csrfToken, expiresAt: s.expiresAt };
    },
  }),
  completeSetup: t.boolean({
    resolve: async (_r, _a, ctx) => {
      await ctx.services.auth.completeSetup(requireActor(ctx));
      return true;
    },
  }),
  login: t.field({
    type: AuthPayloadRef,
    args: { input: t.arg({ type: LoginInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      const s = await ctx.services.auth.login({ login: input.login, password: input.password, remember: input.remember ?? false }, client(ctx));
      ctx.request.setSession(s.token, s.csrfToken, s.expiresAt);
      return { user: s.user, csrfToken: s.csrfToken, expiresAt: s.expiresAt };
    },
  }),
  logout: t.boolean({
    resolve: async (_r, _a, ctx) => {
      if (ctx.sessionToken) await ctx.services.auth.logout(ctx.sessionToken, ctx.actor);
      ctx.request.clearSession();
      return true;
    },
  }),
  signup: t.field({
    type: AuthPayloadRef,
    args: { input: t.arg({ type: SignupInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      const s = await ctx.services.auth.signup(input, client(ctx));
      ctx.request.setSession(s.token, s.csrfToken, s.expiresAt);
      return { user: s.user, csrfToken: s.csrfToken, expiresAt: s.expiresAt };
    },
  }),
  acceptInvite: t.field({
    type: AuthPayloadRef,
    args: { input: t.arg({ type: AcceptInviteInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      const s = await ctx.services.auth.acceptInvite(input, client(ctx));
      ctx.request.setSession(s.token, s.csrfToken, s.expiresAt);
      return { user: s.user, csrfToken: s.csrfToken, expiresAt: s.expiresAt };
    },
  }),
  changePassword: t.boolean({
    args: { currentPassword: t.arg.string({ required: true }), newPassword: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.auth.changePassword(requireSessionActor(ctx), a, ctx.sessionId);
      return true;
    },
  }),
  revokeSession: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.auth.revokeSession(requireSessionActor(ctx), a.id);
      return true;
    },
  }),
  revokeOtherSessions: t.int({
    resolve: (_r, _a, ctx) => ctx.services.auth.revokeAllSessions(requireSessionActor(ctx), ctx.sessionId),
  }),
  updateProfile: t.field({
    type: UserRef,
    args: { input: t.arg({ type: ProfileInput, required: true }) },
    resolve: (_r, { input }, ctx) => ctx.services.users.updateProfile(requireActor(ctx), input),
  }),
  uploadAvatar: t.field({
    type: UserRef,
    description: 'Upload a profile image. Re-encoded as WebP with metadata removed, at most 256px.',
    args: { file: t.arg({ type: 'File', required: true }) },
    resolve: async (_r, { file }, ctx) => {
      const actor = requireActor(ctx);
      return ctx.services.users.uploadAvatar(actor, Buffer.from(await file.arrayBuffer()));
    },
  }),
  removeAvatar: t.field({
    type: UserRef,
    description: 'Clear the profile image and delete the stored file.',
    resolve: (_r, _a, ctx) => ctx.services.users.removeAvatar(requireActor(ctx)),
  }),

  // Members (owner)
  createInvite: t.field({
    type: InviteRef,
    args: { name: t.arg.string(), expiresInDays: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      const inv = await ctx.services.auth.createInvite(requireActor(ctx), a);
      return { id: inv.id, name: a.name ?? null, createdAt: new Date(), expiresAt: inv.expiresAt, url: inv.url };
    },
  }),
  revokeInvite: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.auth.revokeInvite(requireActor(ctx), a.id);
      return true;
    },
  }),
  setMemberSuspended: t.field({
    type: UserRef,
    args: { userId: t.arg.id({ required: true }), suspended: t.arg.boolean({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.users.setSuspended(requireActor(ctx), a.userId, a.suspended),
  }),
  setMemberPassword: t.boolean({
    args: { userId: t.arg.id({ required: true }), password: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.users.setPassword(requireActor(ctx), a.userId, a.password);
      return true;
    },
  }),
  removeMember: t.boolean({
    description: 'Owner removes a member, or a member deletes their own account (history stays attributed to a “Former member” stub).',
    args: { userId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.users.remove(requireActor(ctx), a.userId);
      return true;
    },
  }),

  // Workspace (owner)
  updateWorkspace: t.field({
    type: WorkspaceRef,
    args: { input: t.arg({ type: WorkspaceInput, required: true }) },
    resolve: (_r, { input }, ctx) => ctx.services.workspace.update(requireActor(ctx), input),
  }),
  requestWorkspaceDeletion: t.field({
    type: WorkspaceRef,
    args: { confirmName: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.workspace.requestDeletion(requireSessionActor(ctx), a.confirmName),
  }),
  cancelWorkspaceDeletion: t.field({ type: WorkspaceRef, resolve: (_r, _a, ctx) => ctx.services.workspace.cancelDeletion(requireActor(ctx)) }),

  // API keys
  createApiKey: t.field({
    type: CreatedApiKeyRef,
    args: { name: t.arg.string({ required: true }), scope: t.arg({ type: ApiKeyScopeEnum, required: true }), expiresInDays: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      const actor = requireActor(ctx);
      const { apiKey, plaintext } = await ctx.services.apiKeys.create(actor, a);
      const user = await ctx.loaders.user.load(apiKey.userId);
      return { apiKey: { ...apiKey, userName: user?.name ?? '' }, plaintext };
    },
  }),
  revokeApiKey: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.apiKeys.revoke(requireActor(ctx), a.id);
      return true;
    },
  }),

  // Teams & workflows
  createTeam: t.field({
    type: TeamRef,
    args: { input: t.arg({ type: TeamCreateInput, required: true }) },
    resolve: (_r, { input }, ctx) => ctx.services.teams.create(requireActor(ctx), input),
  }),
  updateTeam: t.field({
    type: TeamRef,
    args: { id: t.arg.id({ required: true }), input: t.arg({ type: TeamUpdateInput, required: true }) },
    resolve: (_r, { id, input }, ctx) => ctx.services.teams.update(requireActor(ctx), id, input as Parameters<typeof ctx.services.teams.update>[2]),
  }),
  archiveTeam: t.field({
    type: TeamRef,
    args: { id: t.arg.id({ required: true }), archived: t.arg.boolean({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.teams.setArchived(requireActor(ctx), a.id, a.archived),
  }),
  deleteTeam: t.boolean({
    args: { id: t.arg.id({ required: true }), confirmKey: t.arg.string({ required: true }), moveIssuesToTeamId: t.arg.id() },
    resolve: async (_r, a, ctx) => {
      await ctx.services.teams.delete(requireActor(ctx), a.id, { confirmKey: a.confirmKey, moveIssuesToTeamId: a.moveIssuesToTeamId });
      return true;
    },
  }),
  reorderTeam: t.field({
    type: TeamRef,
    args: { id: t.arg.id({ required: true }), beforeId: t.arg.id(), afterId: t.arg.id() },
    resolve: (_r, a, ctx) => ctx.services.teams.reorder(requireActor(ctx), a.id, a.beforeId ?? null, a.afterId ?? null),
  }),
  setTeamMembership: t.boolean({
    args: { teamId: t.arg.id({ required: true }), userId: t.arg.id({ required: true }), member: t.arg.boolean({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.teams.setMembership(requireActor(ctx), a.teamId, a.userId, a.member);
      return true;
    },
  }),
  createStatus: t.field({
    type: StatusRef,
    args: { teamId: t.arg.id({ required: true }), input: t.arg({ type: StatusCreateInput, required: true }) },
    resolve: (_r, a, ctx) => ctx.services.teams.createStatus(requireActor(ctx), a.teamId, a.input),
  }),
  updateStatus: t.field({
    type: StatusRef,
    args: { id: t.arg.id({ required: true }), input: t.arg({ type: StatusUpdateInput, required: true }) },
    resolve: (_r, a, ctx) => ctx.services.teams.updateStatus(requireActor(ctx), a.id, a.input),
  }),
  reorderStatus: t.field({
    type: StatusRef,
    args: { id: t.arg.id({ required: true }), beforeId: t.arg.id(), afterId: t.arg.id() },
    resolve: (_r, a, ctx) => ctx.services.teams.reorderStatus(requireActor(ctx), a.id, a.beforeId ?? null, a.afterId ?? null),
  }),
  deleteStatus: t.boolean({
    args: { id: t.arg.id({ required: true }), replacementStatusId: t.arg.id() },
    resolve: async (_r, a, ctx) => {
      await ctx.services.teams.deleteStatus(requireActor(ctx), a.id, a.replacementStatusId);
      return true;
    },
  }),

  // Labels
  createLabel: t.field({
    type: LabelRef,
    args: { input: t.arg({ type: LabelCreateInput, required: true }) },
    resolve: (_r, { input }, ctx) => ctx.services.labels.create(requireActor(ctx), input),
  }),
  updateLabel: t.field({
    type: LabelRef,
    args: { id: t.arg.id({ required: true }), input: t.arg({ type: LabelUpdateInput, required: true }) },
    resolve: (_r, a, ctx) => ctx.services.labels.update(requireActor(ctx), a.id, a.input),
  }),
  deleteLabel: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.labels.delete(requireActor(ctx), a.id);
      return true;
    },
  }),
}));

export function assertNever(x: never): never {
  throw new GraphQLError(`Unexpected ${String(x)}`);
}
