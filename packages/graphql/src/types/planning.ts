import { GraphQLError } from 'graphql';
import type { ViewDisplay } from '@velocity/schema';
import { builder } from '../builder';
import { requireActor } from '../errors';
import { parseFilter, serializeFilter } from '../dsl/index';
import {
  CycleLiveStatsRef,
  CycleRef,
  CycleStatsRef,
  FavoriteKindEnum,
  FavoriteRef,
  GroupByEnum,
  IssueRef,
  LayoutEnum,
  MilestoneRef,
  MilestoneStatusEnum,
  OrderingEnum,
  PaletteColorEnum,
  ProgressRef,
  ProjectHealthEnum,
  ProjectRef,
  ProjectStatusEnum,
  TeamRef,
  UserRef,
  ViewDisplayRef,
  ViewRef,
} from '../refs';

// ───────────── Cycles ─────────────

CycleStatsRef.implement({
  description: 'Immutable snapshot taken when a cycle closes (SPEC §3.8).',
  fields: (t) => ({
    scopeCount: t.exposeInt('scopeCount'),
    scopePoints: t.exposeInt('scopePoints'),
    completedCount: t.exposeInt('completedCount'),
    completedPoints: t.exposeInt('completedPoints'),
    canceledCount: t.exposeInt('canceledCount'),
    addedAfterStartCount: t.exposeInt('addedAfterStartCount'),
    removedCount: t.exposeInt('removedCount'),
    carriedOverCount: t.exposeInt('carriedOverCount'),
  }),
});

CycleLiveStatsRef.implement({
  fields: (t) => ({
    scopeCount: t.exposeInt('scopeCount'),
    scopePoints: t.exposeInt('scopePoints'),
    completedCount: t.exposeInt('completedCount'),
    completedPoints: t.exposeInt('completedPoints'),
    startedCount: t.exposeInt('startedCount'),
    canceledCount: t.exposeInt('canceledCount'),
    addedAfterStartCount: t.exposeInt('addedAfterStartCount'),
  }),
});

CycleRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    number: t.exposeInt('number'),
    name: t.string({ resolve: (c) => c.name ?? `Cycle ${c.number}` }),
    customName: t.exposeString('name', { nullable: true }),
    teamId: t.exposeID('teamId'),
    team: t.field({ type: TeamRef, resolve: async (c, _a, ctx) => (await ctx.loaders.team.load(c.teamId))! }),
    startsAt: t.expose('startsAt', { type: 'DateTime' }),
    endsAt: t.expose('endsAt', { type: 'DateTime' }),
    closedAt: t.expose('closedAt', { type: 'DateTime', nullable: true }),
    isActive: t.boolean({ resolve: (c) => !c.closedAt && c.startsAt <= new Date() && c.endsAt > new Date() }),
    isUpcoming: t.boolean({ resolve: (c) => !c.closedAt && c.startsAt > new Date() }),
    stats: t.field({ type: CycleStatsRef, nullable: true, resolve: (c) => c.stats ?? null }),
    liveStats: t.field({
      type: CycleLiveStatsRef,
      resolve: async (c, _a, ctx) => (await ctx.services.cycles.liveStats([c.id])).get(c.id)!,
    }),
    addedAfterStartIssueIds: t.idList({ resolve: (c, _a, ctx) => ctx.services.cycles.addedAfterStart(c.id) }),
  }),
});

const VelocityPointRef = builder.objectRef<{ cycleId: string; number: number; completedPoints: number; completedCount: number; scopePoints: number }>('VelocityPoint');
VelocityPointRef.implement({
  fields: (t) => ({
    cycleId: t.exposeID('cycleId'),
    number: t.exposeInt('number'),
    completedPoints: t.exposeInt('completedPoints'),
    completedCount: t.exposeInt('completedCount'),
    scopePoints: t.exposeInt('scopePoints'),
  }),
});
const VelocityRef = builder.objectRef<{ points: number; count: number; history: { cycleId: string; number: number; completedPoints: number; completedCount: number; scopePoints: number }[] }>('Velocity');
VelocityRef.implement({
  fields: (t) => ({
    points: t.exposeFloat('points', { description: 'Average completed points of the last cycles.' }),
    count: t.exposeFloat('count'),
    history: t.field({ type: [VelocityPointRef], resolve: (v) => v.history }),
  }),
});

// ───────────── Projects ─────────────

ProjectRef.implement({
  description: 'Cross-team effort with milestones, progress and health (SPEC §3.9).',
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    descriptionMd: t.exposeString('descriptionMd'),
    icon: t.exposeString('icon', { nullable: true }),
    color: t.field({ type: PaletteColorEnum, resolve: (p) => p.color }),
    status: t.field({ type: ProjectStatusEnum, resolve: (p) => p.status }),
    health: t.field({ type: ProjectHealthEnum, nullable: true, resolve: (p) => p.health }),
    targetDate: t.expose('targetDate', { type: 'Date', nullable: true }),
    lead: t.field({ type: UserRef, nullable: true, resolve: (p, _a, ctx) => (p.leadId ? ctx.loaders.user.load(p.leadId) : null) }),
    leadId: t.exposeID('leadId', { nullable: true }),
    progress: t.field({
      type: ProgressRef,
      resolve: (p) => ({ done: p.progressDone, total: p.progressTotal, pointsDone: p.progressPointsDone, pointsTotal: p.progressPointsTotal }),
    }),
    milestones: t.field({ type: [MilestoneRef], resolve: (p, _a, ctx) => ctx.loaders.projectMilestones.load(p.id) }),
    teams: t.field({
      type: [TeamRef],
      resolve: async (p, _a, ctx) => {
        const ids = await ctx.loaders.projectTeamIds.load(p.id);
        return (await Promise.all(ids.map((id) => ctx.loaders.team.load(id)))).filter((x): x is NonNullable<typeof x> => Boolean(x));
      },
    }),
    url: t.string({ resolve: (p, _a, ctx) => `${ctx.services.deps.config.appUrl.replace(/\/$/, '')}/project/${p.id}` }),
    archivedAt: t.expose('archivedAt', { type: 'DateTime', nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});

MilestoneRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    projectId: t.exposeID('projectId'),
    project: t.field({ type: ProjectRef, resolve: async (m, _a, ctx) => (await ctx.loaders.project.load(m.projectId))! }),
    name: t.exposeString('name'),
    description: t.exposeString('description', { nullable: true }),
    targetDate: t.expose('targetDate', { type: 'Date', nullable: true }),
    status: t.field({ type: MilestoneStatusEnum, resolve: (m) => m.status }),
    sortOrder: t.exposeFloat('sortOrder'),
    progress: t.field({
      type: ProgressRef,
      resolve: async (m, _a, ctx) => {
        const p = await ctx.loaders.milestoneProgress.load(m.id);
        return { done: p.done, total: p.total, pointsDone: 0, pointsTotal: 0 };
      },
    }),
  }),
});

// ───────────── Views & favorites ─────────────

ViewDisplayRef.implement({
  fields: (t) => ({
    grouping: t.field({ type: GroupByEnum, resolve: (d) => d.grouping }),
    ordering: t.field({ type: OrderingEnum, resolve: (d) => d.ordering }),
    layout: t.field({ type: LayoutEnum, resolve: (d) => d.layout }),
    columns: t.exposeStringList('columns'),
    showSubIssues: t.boolean({ resolve: (d) => d.showSubIssues ?? true }),
    showEmptyGroups: t.boolean({ resolve: (d) => d.showEmptyGroups ?? false }),
    showCompleted: t.string({ resolve: (d) => d.showCompleted ?? 'all' }),
  }),
});

ViewRef.implement({
  description: 'Saved, personal view (SPEC §3.10). `filter` is canonical DSL; share by URL.',
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    icon: t.exposeString('icon', { nullable: true }),
    color: t.field({ type: PaletteColorEnum, nullable: true, resolve: (v) => v.color }),
    filter: t.string({ resolve: (v) => v.filter.dsl }),
    display: t.field({ type: ViewDisplayRef, resolve: (v) => v.display }),
    teamId: t.exposeID('teamId', { nullable: true }),
    team: t.field({ type: TeamRef, nullable: true, resolve: (v, _a, ctx) => (v.teamId ? ctx.loaders.team.load(v.teamId) : null) }),
    owner: t.field({ type: UserRef, nullable: true, resolve: (v, _a, ctx) => ctx.loaders.user.load(v.ownerId) }),
    isMine: t.boolean({ resolve: (v, _a, ctx) => v.ownerId === ctx.actor?.userId }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});

FavoriteRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    kind: t.field({ type: FavoriteKindEnum, resolve: (f) => f.kind }),
    targetId: t.exposeID('targetId'),
    sortOrder: t.exposeFloat('sortOrder'),
    view: t.field({ type: ViewRef, nullable: true, resolve: (f, _a, ctx) => (f.kind === 'view' ? ctx.loaders.view.load(f.targetId) : null) }),
    project: t.field({ type: ProjectRef, nullable: true, resolve: (f, _a, ctx) => (f.kind === 'project' ? ctx.loaders.project.load(f.targetId) : null) }),
    team: t.field({ type: TeamRef, nullable: true, resolve: (f, _a, ctx) => (f.kind === 'team' ? ctx.loaders.team.load(f.targetId) : null) }),
    issue: t.field({ type: IssueRef, nullable: true, resolve: (f, _a, ctx) => (f.kind === 'issue' ? ctx.loaders.issue.load(f.targetId) : null) }),
    cycle: t.field({ type: CycleRef, nullable: true, resolve: (f, _a, ctx) => (f.kind === 'cycle' ? ctx.loaders.cycle.load(f.targetId) : null) }),
  }),
});

// ───────────── Inputs ─────────────

const ProjectInput = builder.inputType('ProjectInput', {
  fields: (t) => ({
    name: t.string(),
    descriptionMd: t.string(),
    icon: t.string(),
    color: t.field({ type: PaletteColorEnum }),
    status: t.field({ type: ProjectStatusEnum }),
    health: t.field({ type: ProjectHealthEnum }),
    leadId: t.id(),
    targetDate: t.field({ type: 'Date' }),
    teamIds: t.idList(),
  }),
});
const MilestoneInput = builder.inputType('MilestoneInput', {
  fields: (t) => ({ name: t.string(), description: t.string(), targetDate: t.field({ type: 'Date' }), status: t.field({ type: MilestoneStatusEnum }) }),
});
const ViewDisplayInput = builder.inputType('ViewDisplayInput', {
  fields: (t) => ({
    grouping: t.field({ type: GroupByEnum }),
    ordering: t.field({ type: OrderingEnum }),
    layout: t.field({ type: LayoutEnum }),
    columns: t.stringList(),
    showSubIssues: t.boolean(),
    showEmptyGroups: t.boolean(),
    showCompleted: t.string(),
  }),
});
const ViewInput = builder.inputType('ViewInput', {
  fields: (t) => ({
    name: t.string(),
    filter: t.string({ description: 'Filter DSL; stored canonicalized.' }),
    display: t.field({ type: ViewDisplayInput }),
    teamId: t.id(),
    icon: t.string(),
    color: t.field({ type: PaletteColorEnum }),
  }),
});

function cleanDisplay(d: Record<string, unknown> | null | undefined): Partial<ViewDisplay> | null {
  if (!d) return null;
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== undefined)) as Partial<ViewDisplay>;
}

// ───────────── Queries ─────────────

builder.queryFields((t) => ({
  cycles: t.field({
    type: [CycleRef],
    args: { teamId: t.arg.id(), teamKey: t.arg.string(), includeClosed: t.arg.boolean(), first: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireActor(ctx);
      const teamId = a.teamId ?? (a.teamKey ? (await ctx.services.teams.getByKey(a.teamKey))?.id : null);
      if (!teamId) throw new GraphQLError('Pick a team.', { extensions: { code: 'VALIDATION' } });
      return ctx.services.cycles.list(teamId, { includeClosed: a.includeClosed ?? true, limit: a.first ?? 100 });
    },
  }),
  cycle: t.field({
    type: CycleRef,
    nullable: true,
    args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => {
      requireActor(ctx);
      return ctx.services.cycles.get(a.id);
    },
  }),
  cyclesClosingSoon: t.field({
    type: [CycleRef],
    description: 'Active cycles that close within 24 hours (workspace banner).',
    resolve: (_r, _a, ctx) => {
      requireActor(ctx);
      return ctx.services.cycles.closingSoon();
    },
  }),
  teamVelocity: t.field({
    type: VelocityRef,
    args: { teamId: t.arg.id({ required: true }), cycles: t.arg.int() },
    resolve: (_r, a, ctx) => {
      requireActor(ctx);
      return ctx.services.cycles.velocity(a.teamId, a.cycles ?? 6);
    },
  }),
  projects: t.field({
    type: [ProjectRef],
    args: { teamId: t.arg.id(), status: t.arg({ type: [ProjectStatusEnum] }), includeArchived: t.arg.boolean() },
    resolve: (_r, a, ctx) => ctx.services.projects.list(requireActor(ctx), { teamId: a.teamId, status: a.status, includeArchived: a.includeArchived ?? false }),
  }),
  project: t.field({
    type: ProjectRef,
    nullable: true,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireActor(ctx);
      const p = await ctx.services.projects.get(a.id);
      return p && !p.trashedAt ? p : null;
    },
  }),
  views: t.field({
    type: [ViewRef],
    args: { teamId: t.arg.id() },
    resolve: (_r, a, ctx) => ctx.services.views.list(requireActor(ctx), { teamId: a.teamId }),
  }),
  view: t.field({
    type: ViewRef,
    nullable: true,
    args: { id: t.arg.id({ required: true, description: 'UUID or slug.' }) },
    resolve: (_r, a, ctx) => {
      requireActor(ctx);
      return ctx.services.views.get(a.id);
    },
  }),
  favorites: t.field({ type: [FavoriteRef], resolve: (_r, _a, ctx) => ctx.services.views.favorites(requireActor(ctx)) }),
}));

// ───────────── Mutations ─────────────

builder.mutationFields((t) => ({
  closeCycle: t.field({
    type: CycleRef,
    description: 'Close the active cycle early (audited).',
    args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.cycles.closeManually(requireActor(ctx), a.id),
  }),
  renameCycle: t.field({
    type: CycleRef,
    args: { id: t.arg.id({ required: true }), name: t.arg.string() },
    resolve: (_r, a, ctx) => ctx.services.cycles.rename(requireActor(ctx), a.id, a.name ?? null),
  }),
  rotateCycles: t.int({
    description: 'Run the rotation for a team now (normally a daily job). Returns cycles opened.',
    args: { teamId: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      const actor = requireActor(ctx);
      if (!actor.isOwner && actor.scope !== 'write') throw new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } });
      return (await ctx.services.cycles.rotateTeam(a.teamId)).opened;
    },
  }),

  createProject: t.field({
    type: ProjectRef,
    args: { input: t.arg({ type: ProjectInput, required: true }) },
    resolve: (_r, { input }, ctx) => {
      if (!input.name) throw new GraphQLError('Name your project.', { extensions: { code: 'VALIDATION', field: 'name' } });
      return ctx.services.projects.create(requireActor(ctx), { ...input, name: input.name });
    },
  }),
  updateProject: t.field({
    type: ProjectRef,
    args: { id: t.arg.id({ required: true }), input: t.arg({ type: ProjectInput, required: true }) },
    resolve: (_r, a, ctx) => ctx.services.projects.update(requireActor(ctx), a.id, a.input as Parameters<typeof ctx.services.projects.update>[2]),
  }),
  archiveProject: t.field({
    type: ProjectRef,
    args: { id: t.arg.id({ required: true }), archived: t.arg.boolean({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.projects.setArchived(requireActor(ctx), a.id, a.archived),
  }),
  deleteProject: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.projects.trash(requireActor(ctx), a.id);
      return true;
    },
  }),
  reorderProject: t.field({
    type: ProjectRef,
    args: { id: t.arg.id({ required: true }), beforeId: t.arg.id(), afterId: t.arg.id() },
    resolve: (_r, a, ctx) => ctx.services.projects.reorder(requireActor(ctx), a.id, a.beforeId ?? null, a.afterId ?? null),
  }),
  createMilestone: t.field({
    type: MilestoneRef,
    args: { projectId: t.arg.id({ required: true }), input: t.arg({ type: MilestoneInput, required: true }) },
    resolve: (_r, a, ctx) => {
      if (!a.input.name) throw new GraphQLError('Name your milestone.', { extensions: { code: 'VALIDATION', field: 'name' } });
      return ctx.services.projects.createMilestone(requireActor(ctx), a.projectId, { ...a.input, name: a.input.name });
    },
  }),
  updateMilestone: t.field({
    type: MilestoneRef,
    args: { id: t.arg.id({ required: true }), input: t.arg({ type: MilestoneInput, required: true }) },
    resolve: (_r, a, ctx) => ctx.services.projects.updateMilestone(requireActor(ctx), a.id, a.input),
  }),
  reorderMilestone: t.field({
    type: MilestoneRef,
    args: { id: t.arg.id({ required: true }), beforeId: t.arg.id(), afterId: t.arg.id() },
    resolve: (_r, a, ctx) => ctx.services.projects.reorderMilestone(requireActor(ctx), a.id, a.beforeId ?? null, a.afterId ?? null),
  }),
  deleteMilestone: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.projects.deleteMilestone(requireActor(ctx), a.id);
      return true;
    },
  }),

  createView: t.field({
    type: ViewRef,
    args: { input: t.arg({ type: ViewInput, required: true }) },
    resolve: (_r, { input }, ctx) => {
      if (!input.name) throw new GraphQLError('Name your view.', { extensions: { code: 'VALIDATION', field: 'name' } });
      const dsl = serializeFilter(parseFilter(input.filter ?? ''));
      return ctx.services.views.create(requireActor(ctx), { name: input.name, dsl, display: cleanDisplay(input.display), teamId: input.teamId, icon: input.icon, color: input.color });
    },
  }),
  updateView: t.field({
    type: ViewRef,
    args: { id: t.arg.id({ required: true }), input: t.arg({ type: ViewInput, required: true }) },
    resolve: (_r, { id, input }, ctx) =>
      ctx.services.views.update(requireActor(ctx), id, {
        name: input.name,
        dsl: input.filter != null ? serializeFilter(parseFilter(input.filter)) : null,
        display: cleanDisplay(input.display),
        teamId: input.teamId,
        icon: input.icon,
        color: input.color,
      }),
  }),
  deleteView: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.views.delete(requireActor(ctx), a.id);
      return true;
    },
  }),
  addFavorite: t.field({
    type: FavoriteRef,
    args: { kind: t.arg({ type: FavoriteKindEnum, required: true }), targetId: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => ctx.services.views.addFavorite(requireActor(ctx), a.kind, a.targetId),
  }),
  removeFavorite: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await ctx.services.views.removeFavorite(requireActor(ctx), a.id);
      return true;
    },
  }),
  reorderFavorite: t.field({
    type: FavoriteRef,
    args: { id: t.arg.id({ required: true }), beforeId: t.arg.id(), afterId: t.arg.id() },
    resolve: (_r, a, ctx) => ctx.services.views.reorderFavorite(requireActor(ctx), a.id, a.beforeId ?? null, a.afterId ?? null),
  }),
}));
