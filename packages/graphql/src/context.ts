import DataLoader from 'dataloader';
import type {
  CommentRow,
  CycleRow,
  GithubLinkRow,
  IssueRow,
  LabelRow,
  MilestoneRow,
  ProjectRow,
  ReactionRow,
  ServiceActor,
  Services,
  StatusRow,
  TeamRow,
  UserRow,
  ViewRow,
} from '@velocity/services';
import type { VelocityPubSub } from './pubsub';

export interface CookieOptions {
  httpOnly: boolean;
  expires?: Date;
  maxAge?: number;
}

/** Transport-provided hooks (apps/server implements them). */
export interface RequestHooks {
  ip: string | null;
  userAgent: string | null;
  /** Set the session + CSRF cookies after login/setup/invite acceptance. */
  setSession(token: string, csrfToken: string, expiresAt: Date): void;
  clearSession(): void;
}

export interface GqlContext {
  services: Services;
  pubsub: VelocityPubSub;
  /** Null when unauthenticated (only setup/login/invite operations are allowed). */
  actor: ServiceActor | null;
  sessionId: string | null;
  sessionToken: string | null;
  request: RequestHooks;
  loaders: Loaders;
}

function byId<T extends { id: string }>(rows: T[], ids: readonly string[]): (T | null)[] {
  const m = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => m.get(id) ?? null);
}

export interface Loaders {
  user: DataLoader<string, UserRow | null>;
  team: DataLoader<string, TeamRow | null>;
  status: DataLoader<string, StatusRow | null>;
  teamStatuses: DataLoader<string, StatusRow[]>;
  label: DataLoader<string, LabelRow | null>;
  issue: DataLoader<string, IssueRow | null>;
  issueLabelIds: DataLoader<string, string[]>;
  project: DataLoader<string, ProjectRow | null>;
  projectTeamIds: DataLoader<string, string[]>;
  milestone: DataLoader<string, MilestoneRow | null>;
  projectMilestones: DataLoader<string, MilestoneRow[]>;
  milestoneProgress: DataLoader<string, { done: number; total: number }>;
  cycle: DataLoader<string, CycleRow | null>;
  rollup: DataLoader<string, { done: number; total: number }>;
  comments: DataLoader<string, CommentRow[]>;
  reactions: DataLoader<string, ReactionRow[]>;
  subscribed: DataLoader<string, boolean>;
  githubLinks: DataLoader<string, GithubLinkRow[]>;
  view: DataLoader<string, ViewRow | null>;
}

export function createLoaders(services: Services, actor: ServiceActor | null): Loaders {
  const cache = { cache: true };
  // Loaders are constructed lazily on first use: most requests touch only a
  // few of them, so eagerly building all ~20 DataLoader instances per request
  // is pure overhead on the event loop (SPEC §4.16 interaction budgets).
  const lazy = <K, V>(batch: DataLoader.BatchLoadFn<K, V>, cached = false): (() => DataLoader<K, V>) => {
    let instance: DataLoader<K, V> | null = null;
    return () => (instance ??= new DataLoader(batch, cached ? cache : undefined));
  };
  const defs = {
    user: lazy<string, UserRow | null>(async (ids) => byId(await services.users.getMany(ids), ids), true),
    team: lazy<string, TeamRow | null>(async (ids) => byId(await services.teams.getMany(ids), ids), true),
    status: lazy<string, StatusRow | null>(async (ids) => byId(await services.teams.getStatuses(ids), ids), true),
    teamStatuses: lazy<string, StatusRow[]>(async (teamIds) => {
      const rows = await services.teams.statusesForTeams(teamIds);
      return teamIds.map((t) => rows.filter((r) => r.teamId === t));
    }),
    label: lazy<string, LabelRow | null>(async (ids) => byId(await services.labels.getMany(ids), ids), true),
    issue: lazy<string, IssueRow | null>(async (ids) => byId(await services.issues.getMany(ids), ids), true),
    issueLabelIds: lazy<string, string[]>(async (ids) => {
      const m = await services.issues.labelIdsFor(ids);
      return ids.map((id) => m.get(id) ?? []);
    }),
    project: lazy<string, ProjectRow | null>(async (ids) => byId(await services.projects.getMany(ids), ids), true),
    projectTeamIds: lazy<string, string[]>(async (ids) => {
      const m = await services.projects.teamIds(ids);
      return ids.map((id) => m.get(id) ?? []);
    }),
    milestone: lazy<string, MilestoneRow | null>(async (ids) => byId(await services.projects.getMilestones(ids), ids), true),
    projectMilestones: lazy<string, MilestoneRow[]>(async (projectIds) => {
      const rows = await services.projects.milestones(projectIds);
      return projectIds.map((p) => rows.filter((r) => r.projectId === p));
    }),
    milestoneProgress: lazy<string, { done: number; total: number }>(async (ids) => {
      const m = await services.projects.milestoneProgress(ids);
      return ids.map((id) => m.get(id) ?? { done: 0, total: 0 });
    }),
    cycle: lazy<string, CycleRow | null>(async (ids) => byId(await services.cycles.getMany(ids), ids), true),
    rollup: lazy<string, { done: number; total: number }>(async (ids) => {
      const m = await services.issues.rollups(ids);
      return ids.map((id) => m.get(id) ?? { done: 0, total: 0 });
    }),
    comments: lazy<string, CommentRow[]>(async (issueIds) => {
      const rows = await services.comments.listForIssues(issueIds);
      return issueIds.map((i) => rows.filter((r) => r.issueId === i));
    }),
    reactions: lazy<string, ReactionRow[]>(async (commentIds) => {
      const rows = await services.comments.reactionsFor(commentIds);
      return commentIds.map((c) => rows.filter((r) => r.commentId === c));
    }),
    subscribed: lazy<string, boolean>(async (issueIds) => {
      if (!actor?.userId) return issueIds.map(() => false);
      const s = await services.issues.isSubscribed(issueIds, actor.userId);
      return issueIds.map((i) => s.has(i));
    }),
    githubLinks: lazy<string, GithubLinkRow[]>(async (issueIds) => {
      const rows = await services.github.linksFor(issueIds);
      return issueIds.map((i) => rows.filter((r) => r.issueId === i));
    }),
    view: lazy<string, ViewRow | null>(async (ids) => byId(await services.views.getMany(ids), ids), true),
  };
  return {
    get user() { return defs.user(); },
    get team() { return defs.team(); },
    get status() { return defs.status(); },
    get teamStatuses() { return defs.teamStatuses(); },
    get label() { return defs.label(); },
    get issue() { return defs.issue(); },
    get issueLabelIds() { return defs.issueLabelIds(); },
    get project() { return defs.project(); },
    get projectTeamIds() { return defs.projectTeamIds(); },
    get milestone() { return defs.milestone(); },
    get projectMilestones() { return defs.projectMilestones(); },
    get milestoneProgress() { return defs.milestoneProgress(); },
    get cycle() { return defs.cycle(); },
    get rollup() { return defs.rollup(); },
    get comments() { return defs.comments(); },
    get reactions() { return defs.reactions(); },
    get subscribed() { return defs.subscribed(); },
    get githubLinks() { return defs.githubLinks(); },
    get view() { return defs.view(); },
  };
}
