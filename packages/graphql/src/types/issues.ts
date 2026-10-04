import { GraphQLError } from 'graphql';
import type { IssueListArgs, IssuePatch, IssueRow, RelationRow } from '@velocity/services';
import { REACTION_EMOJI } from '@velocity/services';
import { builder } from '../builder';
import { requireActor } from '../errors';
import { DslError, parseFilter, serializeFilter } from '../dsl/index';
import {
  AttachmentRef,
  CommentRef,
  CycleRef,
  GithubLinkRef,
  GroupByEnum,
  IssueRef,
  IssueRelationRef,
  LabelRef,
  MilestoneRef,
  OrderingEnum,
  PageInfoRef,
  ProjectRef,
  RelationInputTypeEnum,
  RelationTypeEnum,
  StatusRef,
  TeamRef,
  UserRef,
  decodeCursor,
  encodeCursor,
} from '../refs';
import type { IssueRelationShape } from '../refs';
import type { GqlContext } from '../context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function relationFromPerspective(issueId: string, r: RelationRow): IssueRelationShape {
  const outgoing = r.sourceIssueId === issueId;
  const other = outgoing ? r.targetIssueId : r.sourceIssueId;
  let type: IssueRelationShape['type'] = r.type;
  if (!outgoing && r.type === 'blocks') type = 'blocked_by';
  if (!outgoing && r.type === 'duplicate') type = 'duplicated_by';
  return { id: r.id, type, issueId: other, createdAt: r.createdAt };
}

async function identifierOf(ctx: GqlContext, issue: Pick<IssueRow, 'teamId' | 'number'>): Promise<string> {
  const team = await ctx.loaders.team.load(issue.teamId);
  return `${team?.key ?? '?'}-${issue.number}`;
}

// ───────────── Issue ─────────────

IssueRef.implement({
  description: 'An issue (SPEC §3.5). `identifier` is the canonical TEAM-123 reference.',
  fields: (t) => ({
    id: t.exposeID('id'),
    identifier: t.string({ resolve: (i, _a, ctx) => identifierOf(ctx, i) }),
    number: t.exposeInt('number'),
    title: t.exposeString('title'),
    descriptionMd: t.exposeString('descriptionMd'),
    url: t.string({ resolve: (i, _a, ctx) => `${ctx.services.deps.config.appUrl.replace(/\/$/, '')}/issue/${i.id}` }),
    teamId: t.exposeID('teamId'),
    team: t.field({ type: TeamRef, resolve: async (i, _a, ctx) => (await ctx.loaders.team.load(i.teamId))! }),
    statusId: t.exposeID('statusId'),
    status: t.field({ type: StatusRef, resolve: async (i, _a, ctx) => (await ctx.loaders.status.load(i.statusId))! }),
    priority: t.exposeInt('priority', { description: '0 Urgent, 1 High, 2 Medium, 3 Low, 4 No priority' }),
    estimate: t.exposeInt('estimate', { nullable: true }),
    sortOrder: t.exposeFloat('sortOrder'),
    assigneeId: t.exposeID('assigneeId', { nullable: true }),
    assignee: t.field({ type: UserRef, nullable: true, resolve: (i, _a, ctx) => (i.assigneeId ? ctx.loaders.user.load(i.assigneeId) : null) }),
    creator: t.field({ type: UserRef, nullable: true, resolve: (i, _a, ctx) => (i.createdBy ? ctx.loaders.user.load(i.createdBy) : null) }),
    labelIds: t.idList({ resolve: (i, _a, ctx) => ctx.loaders.issueLabelIds.load(i.id) }),
    labels: t.field({
      type: [LabelRef],
      resolve: async (i, _a, ctx) => {
        const ids = await ctx.loaders.issueLabelIds.load(i.id);
        return (await Promise.all(ids.map((id) => ctx.loaders.label.load(id)))).filter((l): l is NonNullable<typeof l> => Boolean(l));
      },
    }),
    projectId: t.exposeID('projectId', { nullable: true }),
    project: t.field({ type: ProjectRef, nullable: true, resolve: (i, _a, ctx) => (i.projectId ? ctx.loaders.project.load(i.projectId) : null) }),
    milestoneId: t.exposeID('milestoneId', { nullable: true }),
    milestone: t.field({ type: MilestoneRef, nullable: true, resolve: (i, _a, ctx) => (i.milestoneId ? ctx.loaders.milestone.load(i.milestoneId) : null) }),
    cycleId: t.exposeID('cycleId', { nullable: true }),
    cycle: t.field({ type: CycleRef, nullable: true, resolve: (i, _a, ctx) => (i.cycleId ? ctx.loaders.cycle.load(i.cycleId) : null) }),
    parentId: t.exposeID('parentId', { nullable: true }),
    parent: t.field({ type: IssueRef, nullable: true, resolve: (i, _a, ctx) => (i.parentId ? ctx.loaders.issue.load(i.parentId) : null) }),
    children: t.field({ type: [IssueRef], resolve: (i, _a, ctx) => ctx.services.issues.children(i.id) }),
    subIssueRollup: t.field({
      type: builder.objectRef<{ done: number; total: number }>('SubIssueRollup').implement({
        fields: (u) => ({ done: u.exposeInt('done'), total: u.exposeInt('total') }),
      }),
      resolve: (i, _a, ctx) => ctx.loaders.rollup.load(i.id),
    }),
    relations: t.field({
      type: [IssueRelationRef],
      resolve: async (i, _a, ctx) => (await ctx.services.issues.relationsFor([i.id])).map((r) => relationFromPerspective(i.id, r)),
    }),
    comments: t.field({ type: [CommentRef], resolve: (i, _a, ctx) => ctx.loaders.comments.load(i.id) }),
    commentCount: t.int({ resolve: async (i, _a, ctx) => (await ctx.loaders.comments.load(i.id)).length }),
    activity: t.field({ type: [IssueActivityRef], resolve: (i, _a, ctx) => ctx.services.issues.activity(i.id) }),
    attachments: t.field({ type: [AttachmentRef], resolve: (i, _a, ctx) => ctx.services.attachments.listForIssue(i.id) }),
    githubLinks: t.field({ type: [GithubLinkRef], resolve: (i, _a, ctx) => ctx.loaders.githubLinks.load(i.id) }),
    subscribed: t.boolean({ resolve: (i, _a, ctx) => ctx.loaders.subscribed.load(i.id) }),
    subscribers: t.field({
      type: [UserRef],
      resolve: async (i, _a, ctx) => {
        const ids = await ctx.services.issues.subscriberIds(i.id);
        return (await Promise.all(ids.map((id) => ctx.loaders.user.load(id)))).filter((u): u is NonNullable<typeof u> => Boolean(u));
      },
    }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    startedAt: t.expose('startedAt', { type: 'DateTime', nullable: true }),
    completedAt: t.expose('completedAt', { type: 'DateTime', nullable: true }),
    canceledAt: t.expose('canceledAt', { type: 'DateTime', nullable: true }),
    archivedAt: t.expose('archivedAt', { type: 'DateTime', nullable: true }),
    trashedAt: t.expose('trashedAt', { type: 'DateTime', nullable: true }),
    movedToIssueId: t.exposeID('movedToIssueId', { nullable: true, description: 'Permanent moved-pointer after a team move (SPEC §3.5.1).' }),
    movedTo: t.field({ type: IssueRef, nullable: true, resolve: (i, _a, ctx) => (i.movedToIssueId ? ctx.loaders.issue.load(i.movedToIssueId) : null) }),
  }),
});

IssueRelationRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    type: t.field({ type: RelationTypeEnum, resolve: (r) => r.type }),
    issue: t.field({ type: IssueRef, resolve: async (r, _a, ctx) => (await ctx.loaders.issue.load(r.issueId))! }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
  }),
});

interface ActivityShape {
  id: string;
  type: string;
  actorUserId: string | null;
  actorKind: string;
  fromValue: unknown;
  toValue: unknown;
  createdAt: Date;
}
const IssueActivityRef = builder.objectRef<ActivityShape>('IssueActivity');
IssueActivityRef.implement({
  description: 'Timeline entry: property change, relation, move, GitHub event, … (SPEC §3.5.4).',
  fields: (t) => ({
    id: t.exposeID('id'),
    type: t.exposeString('type'),
    actorKind: t.exposeString('actorKind'),
    actor: t.field({ type: UserRef, nullable: true, resolve: (a, _x, ctx) => (a.actorUserId ? ctx.loaders.user.load(a.actorUserId) : null) }),
    fromValue: t.field({ type: 'JSON', nullable: true, resolve: (a) => a.fromValue ?? null }),
    toValue: t.field({ type: 'JSON', nullable: true, resolve: (a) => a.toValue ?? null }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
  }),
});

const ReactionGroupRef = builder.objectRef<{ emoji: string; userIds: string[]; viewerId: string | null }>('ReactionGroup');
ReactionGroupRef.implement({
  fields: (t) => ({
    emoji: t.exposeString('emoji'),
    count: t.int({ resolve: (g) => g.userIds.length }),
    userIds: t.exposeIDList('userIds'),
    reacted: t.boolean({ resolve: (g) => Boolean(g.viewerId && g.userIds.includes(g.viewerId)) }),
  }),
});

CommentRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    issueId: t.exposeID('issueId'),
    issue: t.field({ type: IssueRef, resolve: async (c, _a, ctx) => (await ctx.loaders.issue.load(c.issueId))! }),
    author: t.field({ type: UserRef, nullable: true, resolve: (c, _a, ctx) => (c.authorId ? ctx.loaders.user.load(c.authorId) : null) }),
    authorName: t.exposeString('authorName', { nullable: true, description: 'Display name for imported/GitHub comments without a member author.' }),
    source: t.exposeString('source'),
    bodyMd: t.exposeString('bodyMd'),
    editedAt: t.expose('editedAt', { type: 'DateTime', nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    reactions: t.field({
      type: [ReactionGroupRef],
      resolve: async (c, _a, ctx) => {
        const rows = await ctx.loaders.reactions.load(c.id);
        const groups = new Map<string, string[]>();
        for (const r of rows) groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r.userId]);
        return [...groups.entries()].map(([emoji, userIds]) => ({ emoji, userIds, viewerId: ctx.actor?.userId ?? null }));
      },
    }),
  }),
});

AttachmentRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    filename: t.exposeString('filename'),
    mime: t.exposeString('mime'),
    size: t.exposeInt('size'),
    url: t.string({ description: 'Time-limited signed URL (1h).', resolve: (a, _x, ctx) => ctx.services.attachments.signedPath(a.id) }),
    issueId: t.exposeID('issueId', { nullable: true }),
    commentId: t.exposeID('commentId', { nullable: true }),
    uploader: t.field({ type: UserRef, nullable: true, resolve: (a, _x, ctx) => (a.uploaderId ? ctx.loaders.user.load(a.uploaderId) : null) }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
  }),
});

// ───────────── Connections ─────────────

interface IssueConnectionShape {
  nodes: IssueRow[];
  totalCount: number;
  offset: number;
  hasNextPage: boolean;
}
const IssueEdgeRef = builder.objectRef<{ node: IssueRow; cursor: string }>('IssueEdge');
IssueEdgeRef.implement({ fields: (t) => ({ node: t.field({ type: IssueRef, resolve: (e) => e.node }), cursor: t.exposeString('cursor') }) });

const IssueConnectionRef = builder.objectRef<IssueConnectionShape>('IssueConnection');
IssueConnectionRef.implement({
  fields: (t) => ({
    nodes: t.field({ type: [IssueRef], resolve: (c) => c.nodes }),
    edges: t.field({ type: [IssueEdgeRef], resolve: (c) => c.nodes.map((node, i) => ({ node, cursor: encodeCursor(c.offset + i + 1) })) }),
    totalCount: t.exposeInt('totalCount'),
    pageInfo: t.field({
      type: PageInfoRef,
      resolve: (c) => ({ hasNextPage: c.hasNextPage, endCursor: c.nodes.length ? encodeCursor(c.offset + c.nodes.length) : null }),
    }),
  }),
});

const GroupCountRef = builder.objectRef<{ key: string | null; count: number }>('IssueGroupCount');
GroupCountRef.implement({ fields: (t) => ({ key: t.exposeString('key', { nullable: true }), count: t.exposeInt('count') }) });

const FilterErrorRef = builder.objectRef<{ message: string; position: number; caret: string }>('FilterError');
FilterErrorRef.implement({
  fields: (t) => ({ message: t.exposeString('message'), position: t.exposeInt('position'), caret: t.exposeString('caret') }),
});
const FilterParseResultRef = builder.objectRef<{ ok: boolean; canonical: string | null; ast: unknown; error: { message: string; position: number; caret: string } | null }>('FilterParseResult');
FilterParseResultRef.implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    canonical: t.exposeString('canonical', { nullable: true }),
    ast: t.field({ type: 'JSON', nullable: true, resolve: (r) => r.ast ?? null }),
    error: t.field({ type: FilterErrorRef, nullable: true, resolve: (r) => r.error }),
  }),
});

// ───────────── Shared list args ─────────────

const listArgs = (t: Parameters<Parameters<typeof builder.queryFields>[0]>[0]) => ({
  filter: t.arg.string({ description: 'Filter DSL (SPEC §6.1.4), e.g. `assignee:me and priority lt:2 order:priority asc`.' }),
  teamId: t.arg.id(),
  teamKey: t.arg.string(),
  projectId: t.arg.id(),
  cycleId: t.arg.id(),
  milestoneId: t.arg.id(),
  parentId: t.arg.id(),
  subscribed: t.arg.boolean({ description: 'Only issues the viewer is subscribed to.' }),
  ordering: t.arg({ type: OrderingEnum }),
  includeArchived: t.arg.boolean(),
  includeSubIssues: t.arg.boolean(),
  onlyTrashed: t.arg.boolean(),
});

type ListArgValues = {
  filter?: string | null;
  teamId?: string | null;
  teamKey?: string | null;
  projectId?: string | null;
  cycleId?: string | null;
  milestoneId?: string | null;
  parentId?: string | null;
  subscribed?: boolean | null;
  ordering?: string | null;
  includeArchived?: boolean | null;
  includeSubIssues?: boolean | null;
  onlyTrashed?: boolean | null;
};

async function toListArgs(ctx: GqlContext, a: ListArgValues): Promise<IssueListArgs> {
  let teamId = a.teamId ?? null;
  if (!teamId && a.teamKey) {
    const team = await ctx.services.teams.getByKey(a.teamKey);
    if (!team) throw new GraphQLError(`No team with key ${a.teamKey}.`, { extensions: { code: 'NOT_FOUND' } });
    teamId = team.id;
  }
  return {
    filter: a.filter ? parseFilter(a.filter) : null,
    teamId,
    projectId: a.projectId,
    cycleId: a.cycleId,
    milestoneId: a.milestoneId,
    parentId: a.parentId,
    subscribedBy: a.subscribed ? (ctx.actor?.userId ?? null) : null,
    ordering: a.ordering,
    includeArchived: a.includeArchived,
    includeSubIssues: a.includeSubIssues,
    onlyTrashed: a.onlyTrashed,
  };
}

// ───────────── Inputs ─────────────

const CreateIssueInput = builder.inputType('CreateIssueInput', {
  fields: (t) => ({
    id: t.id({ description: 'Optional client-minted UUID (optimistic create).' }),
    teamId: t.id(),
    teamKey: t.string({ description: 'Alternative to teamId, e.g. "ENG".' }),
    title: t.string({ required: true }),
    descriptionMd: t.string(),
    statusId: t.id(),
    assigneeId: t.id(),
    priority: t.int(),
    estimate: t.int(),
    labelIds: t.idList(),
    projectId: t.id(),
    milestoneId: t.id(),
    cycleId: t.id(),
    parentId: t.id(),
    sortOrder: t.float(),
  }),
});

const UpdateIssueInput = builder.inputType('UpdateIssueInput', {
  fields: (t) => ({
    title: t.string(),
    descriptionMd: t.string(),
    statusId: t.id(),
    assigneeId: t.id(),
    priority: t.int(),
    estimate: t.int(),
    labelIds: t.idList(),
    addLabelIds: t.idList(),
    removeLabelIds: t.idList(),
    projectId: t.id(),
    milestoneId: t.id(),
    cycleId: t.id(),
    parentId: t.id(),
  }),
});

async function resolveIssueId(ctx: GqlContext, idOrIdentifier: string): Promise<string> {
  if (UUID_RE.test(idOrIdentifier)) return idOrIdentifier;
  const i = await ctx.services.issues.getByIdentifier(idOrIdentifier);
  if (!i) throw new GraphQLError('Issue not found.', { extensions: { code: 'NOT_FOUND' } });
  return i.id;
}

function toPatch(input: Record<string, unknown>): IssuePatch {
  return input as IssuePatch;
}

// ───────────── Queries ─────────────

builder.queryFields((t) => ({
  issue: t.field({
    type: IssueRef,
    nullable: true,
    description: 'By UUID or identifier (ENG-123). Moved issues resolve to their new location unless followMoves is false.',
    args: { id: t.arg.id({ required: true }), followMoves: t.arg.boolean() },
    resolve: async (_r, a, ctx) => {
      requireActor(ctx);
      if (UUID_RE.test(a.id)) {
        const i = await ctx.services.issues.get(a.id);
        if (i?.movedToIssueId && a.followMoves !== false) return ctx.services.issues.get(i.movedToIssueId);
        return i;
      }
      return ctx.services.issues.getByIdentifier(a.id, { followMoves: a.followMoves ?? true });
    },
  }),
  issueByIdentifier: t.field({
    type: IssueRef,
    nullable: true,
    args: { identifier: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => {
      requireActor(ctx);
      return ctx.services.issues.getByIdentifier(a.identifier);
    },
  }),
  issues: t.field({
    type: IssueConnectionRef,
    args: { ...listArgs(t), groupBy: t.arg({ type: GroupByEnum }), first: t.arg.int(), after: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      const actor = requireActor(ctx);
      const args = await toListArgs(ctx, a);
      return ctx.services.issues.list(actor, { ...args, groupBy: a.groupBy, first: a.first ?? 100, offset: decodeCursor(a.after) });
    },
  }),
  issueGroupCounts: t.field({
    type: [GroupCountRef],
    args: { ...listArgs(t), groupBy: t.arg({ type: GroupByEnum, required: true }) },
    resolve: async (_r, a, ctx) => {
      const actor = requireActor(ctx);
      return ctx.services.issues.groupCounts(actor, { ...(await toListArgs(ctx, a)), groupBy: a.groupBy });
    },
  }),
  parseFilter: t.field({
    type: FilterParseResultRef,
    description: 'Validate a filter DSL string; returns the canonical form or a typed error with a caret.',
    args: { dsl: t.arg.string({ required: true }) },
    resolve: (_r, a) => {
      try {
        const q = parseFilter(a.dsl);
        return { ok: true, canonical: serializeFilter(q), ast: q, error: null };
      } catch (err) {
        if (err instanceof DslError) return { ok: false, canonical: null, ast: null, error: err.info };
        throw err;
      }
    },
  }),
  reactionEmoji: t.stringList({ resolve: () => [...REACTION_EMOJI] }),
}));

// ───────────── Mutations ─────────────

builder.mutationFields((t) => ({
  createIssue: t.field({
    type: IssueRef,
    args: { input: t.arg({ type: CreateIssueInput, required: true }) },
    resolve: async (_r, { input }, ctx) => {
      const actor = requireActor(ctx);
      let teamId = input.teamId ?? null;
      if (!teamId && input.teamKey) teamId = (await ctx.services.teams.getByKey(input.teamKey))?.id ?? null;
      if (!teamId) throw new GraphQLError('Pick a team (teamId or teamKey).', { extensions: { code: 'VALIDATION', field: 'teamId' } });
      return ctx.services.issues.create(actor, { ...input, teamId });
    },
  }),
  updateIssue: t.field({
    type: IssueRef,
    args: {
      id: t.arg.id({ required: true, description: 'UUID or identifier.' }),
      input: t.arg({ type: UpdateIssueInput, required: true }),
      expectedUpdatedAt: t.arg({ type: 'DateTime', description: 'Optimistic concurrency guard → CONFLICT on mismatch.' }),
    },
    resolve: async (_r, a, ctx) => ctx.services.issues.update(requireActor(ctx), await resolveIssueId(ctx, a.id), toPatch(a.input), { expectedUpdatedAt: a.expectedUpdatedAt }),
  }),
  bulkUpdateIssues: t.field({
    type: [IssueRef],
    args: { ids: t.arg.idList({ required: true }), input: t.arg({ type: UpdateIssueInput, required: true }) },
    resolve: (_r, a, ctx) => ctx.services.issues.bulkUpdate(requireActor(ctx), a.ids, toPatch(a.input)),
  }),
  toggleIssueDone: t.field({
    type: IssueRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => ctx.services.issues.toggleDone(requireActor(ctx), await resolveIssueId(ctx, a.id)),
  }),
  reorderIssue: t.field({
    type: IssueRef,
    args: { id: t.arg.id({ required: true }), beforeId: t.arg.id(), afterId: t.arg.id() },
    resolve: (_r, a, ctx) => ctx.services.issues.reorder(requireActor(ctx), a.id, a.beforeId ?? null, a.afterId ?? null),
  }),
  archiveIssues: t.field({
    type: [IssueRef],
    args: { ids: t.arg.idList({ required: true }), archived: t.arg.boolean({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.issues.setArchived(requireActor(ctx), a.ids, a.archived),
  }),
  trashIssues: t.field({
    type: [IssueRef],
    args: { ids: t.arg.idList({ required: true }), trashed: t.arg.boolean({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.issues.setTrashed(requireActor(ctx), a.ids, a.trashed),
  }),
  deleteIssueForever: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.issues.deleteForever(requireActor(ctx), a.id);
      return true;
    },
  }),
  moveIssue: t.field({
    type: IssueRef,
    args: { id: t.arg.id({ required: true }), teamId: t.arg.id({ required: true }), statusId: t.arg.id() },
    resolve: async (_r, a, ctx) => ctx.services.issues.move(requireActor(ctx), await resolveIssueId(ctx, a.id), a.teamId, { statusId: a.statusId }),
  }),
  duplicateIssue: t.field({
    type: IssueRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => ctx.services.issues.duplicate(requireActor(ctx), await resolveIssueId(ctx, a.id)),
  }),
  addRelation: t.field({
    type: IssueRelationRef,
    args: { issueId: t.arg.id({ required: true }), type: t.arg({ type: RelationInputTypeEnum, required: true }), targetIssueId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      const issueId = await resolveIssueId(ctx, a.issueId);
      const row = await ctx.services.issues.addRelation(requireActor(ctx), issueId, a.type, await resolveIssueId(ctx, a.targetIssueId));
      return relationFromPerspective(issueId, row);
    },
  }),
  removeRelation: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.issues.removeRelation(requireActor(ctx), a.id);
      return true;
    },
  }),
  setIssueSubscribed: t.field({
    type: IssueRef,
    args: { id: t.arg.id({ required: true }), subscribed: t.arg.boolean({ required: true }) },
    resolve: async (_r, a, ctx) => {
      const id = await resolveIssueId(ctx, a.id);
      await ctx.services.issues.setSubscribed(requireActor(ctx), id, a.subscribed);
      ctx.loaders.subscribed.clear(id);
      return (await ctx.services.issues.get(id))!;
    },
  }),
  createComment: t.field({
    type: CommentRef,
    args: { issueId: t.arg.id({ required: true }), bodyMd: t.arg.string({ required: true }), id: t.arg.id() },
    resolve: async (_r, a, ctx) => ctx.services.comments.create(requireActor(ctx), { issueId: await resolveIssueId(ctx, a.issueId), bodyMd: a.bodyMd, id: a.id }),
  }),
  updateComment: t.field({
    type: CommentRef,
    args: { id: t.arg.id({ required: true }), bodyMd: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.comments.update(requireActor(ctx), a.id, a.bodyMd),
  }),
  deleteComment: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.comments.delete(requireActor(ctx), a.id);
      return true;
    },
  }),
  toggleReaction: t.field({
    type: CommentRef,
    args: { commentId: t.arg.id({ required: true }), emoji: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.comments.toggleReaction(requireActor(ctx), a.commentId, a.emoji);
      ctx.loaders.reactions.clear(a.commentId);
      return (await ctx.services.comments.get(a.commentId))!;
    },
  }),
  uploadAttachment: t.field({
    type: AttachmentRef,
    description: 'GraphQL multipart upload. Images are re-encoded to strip EXIF.',
    args: { file: t.arg({ type: 'File', required: true }), issueId: t.arg.id(), commentId: t.arg.id() },
    resolve: async (_r, a, ctx) => {
      const buf = Buffer.from(await a.file.arrayBuffer());
      return ctx.services.attachments.upload(requireActor(ctx), {
        issueId: a.issueId ? await resolveIssueId(ctx, a.issueId) : null,
        commentId: a.commentId,
        filename: a.file.name,
        mime: a.file.type,
        data: buf,
      });
    },
  }),
  deleteAttachment: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.attachments.delete(requireActor(ctx), a.id);
      return true;
    },
  }),
}));
