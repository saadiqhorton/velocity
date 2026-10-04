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
  return {
    user: new DataLoader(async (ids) => byId(await services.users.getMany(ids), ids), cache),
    team: new DataLoader(async (ids) => byId(await services.teams.getMany(ids), ids), cache),
    status: new DataLoader(async (ids) => byId(await services.teams.getStatuses(ids), ids), cache),
    teamStatuses: new DataLoader(async (teamIds) => {
      const rows = await services.teams.statusesForTeams(teamIds);
      return teamIds.map((t) => rows.filter((r) => r.teamId === t));
    }),
    label: new DataLoader(async (ids) => byId(await services.labels.getMany(ids), ids), cache),
    issue: new DataLoader(async (ids) => byId(await services.issues.getMany(ids), ids), cache),
    issueLabelIds: new DataLoader(async (ids) => {
      const m = await services.issues.labelIdsFor(ids);
      return ids.map((id) => m.get(id) ?? []);
    }),
    project: new DataLoader(async (ids) => byId(await services.projects.getMany(ids), ids), cache),
    projectTeamIds: new DataLoader(async (ids) => {
      const m = await services.projects.teamIds(ids);
      return ids.map((id) => m.get(id) ?? []);
    }),
    milestone: new DataLoader(async (ids) => byId(await services.projects.getMilestones(ids), ids), cache),
    projectMilestones: new DataLoader(async (projectIds) => {
      const rows = await services.projects.milestones(projectIds);
      return projectIds.map((p) => rows.filter((r) => r.projectId === p));
    }),
    milestoneProgress: new DataLoader(async (ids) => {
      const m = await services.projects.milestoneProgress(ids);
      return ids.map((id) => m.get(id) ?? { done: 0, total: 0 });
    }),
    cycle: new DataLoader(async (ids) => byId(await services.cycles.getMany(ids), ids), cache),
    rollup: new DataLoader(async (ids) => {
      const m = await services.issues.rollups(ids);
      return ids.map((id) => m.get(id) ?? { done: 0, total: 0 });
    }),
    comments: new DataLoader(async (issueIds) => {
      const rows = await services.comments.listForIssues(issueIds);
      return issueIds.map((i) => rows.filter((r) => r.issueId === i));
    }),
    reactions: new DataLoader(async (commentIds) => {
      const rows = await services.comments.reactionsFor(commentIds);
      return commentIds.map((c) => rows.filter((r) => r.commentId === c));
    }),
    subscribed: new DataLoader(async (issueIds) => {
      if (!actor?.userId) return issueIds.map(() => false);
      const s = await services.issues.isSubscribed(issueIds, actor.userId);
      return issueIds.map((i) => s.has(i));
    }),
    githubLinks: new DataLoader(async (issueIds) => {
      const rows = await services.github.linksFor(issueIds);
      return issueIds.map((i) => rows.filter((r) => r.issueId === i));
    }),
    view: new DataLoader(async (ids) => byId(await services.views.getMany(ids), ids), cache),
  };
}
