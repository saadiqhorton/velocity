import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { App } from '@octokit/app';
import { githubEvents, githubInstalls, githubLinks, issueActivity } from '@velocity/schema';
import type { GithubInstallSettings } from '@velocity/schema';
import { publish } from '@velocity/events';
import { ServiceBase } from './base';
import type { AuditService } from './audit';
import type { CommentService } from './comments';
import type { AppConfig, ServiceActor, ServiceDeps } from './context';
import { actorUserId, systemActor } from './context';
import type { Tx } from './db';
import { ServiceError, notFound, unauthenticated, validation } from './errors';
import type { IssueRow, IssueService } from './issues';
import { verifyHmacSignature } from './lib/crypto';
import { extractIssueRefsFromBranch, findIssueReferences } from './lib/issue-reference';
import { assertCan } from './lib/permissions';
import type { TeamRow, TeamService } from './teams';

export type GithubInstallRow = typeof githubInstalls.$inferSelect;
export type GithubLinkRow = typeof githubLinks.$inferSelect;

export interface WebhookReceipt {
  status: 'accepted' | 'duplicate' | 'ignored';
  eventRowId: string | null;
}

// ───────────────────────────── API seam ─────────────────────────────

/** Normalized pull request as returned by the API seam. */
export interface GitHubPull {
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  mergedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
  headRef: string | null;
  headSha: string | null;
  author: string | null;
}

/**
 * Everything the service needs from GitHub's REST API. Tests inject a fake via
 * `GitHubService.setApi()`; the default implementation is {@link OctokitGitHubApi}.
 */
export interface GitHubApi {
  getInstallation(installationId: number): Promise<{ accountLogin: string; accountType: 'User' | 'Organization' }>;
  /** Full names (`owner/name`) of every repository the installation can access. */
  listInstallationRepos(installationId: number): Promise<string[]>;
  /** One page (1-based) of PRs sorted by updated desc. `hasMore` is false once a page ends before `since`. */
  listPullsSince(installationId: number, repo: string, opts: { since: Date; page: number; perPage: number }): Promise<{ pulls: GitHubPull[]; hasMore: boolean }>;
  getPull(installationId: number, repo: string, number: number): Promise<GitHubPull>;
  createIssueComment(installationId: number, repo: string, issueNumber: number, body: string): Promise<void>;
}

interface RawPull {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state: string;
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  closed_at?: string | null;
  updated_at?: string;
  head?: { ref?: string; sha?: string };
  user?: { login?: string } | null;
}

function normalizePull(p: RawPull): GitHubPull {
  return {
    number: p.number,
    title: p.title,
    body: p.body ?? null,
    url: p.html_url,
    state: p.state === 'closed' ? 'closed' : 'open',
    draft: Boolean(p.draft),
    merged: Boolean(p.merged) || Boolean(p.merged_at),
    mergedAt: p.merged_at ?? null,
    closedAt: p.closed_at ?? null,
    updatedAt: p.updated_at ?? new Date(0).toISOString(),
    headRef: p.head?.ref ?? null,
    headSha: p.head?.sha ?? null,
    author: p.user?.login ?? null,
  };
}

/**
 * Default API seam backed by `@octokit/app`.
 *
 * Installation access tokens are minted per call from the short-lived App JWT (appId +
 * privateKey) and are NEVER stored. That satisfies SPEC §7.1.3 better than encrypting stored
 * tokens: there is no token at rest to leak. The private key itself lives only in config/env.
 */
export class OctokitGitHubApi implements GitHubApi {
  private app: App | null = null;
  constructor(private readonly cfg: AppConfig['github']) {}

  private getApp(): App {
    if (!this.app) {
      if (!this.cfg.appId || !this.cfg.privateKey) throw new ServiceError('VALIDATION', 'The GitHub App is not configured.');
      this.app = new App({ appId: this.cfg.appId, privateKey: this.cfg.privateKey.replace(/\\n/g, '\n') });
    }
    return this.app;
  }

  async getInstallation(installationId: number): Promise<{ accountLogin: string; accountType: 'User' | 'Organization' }> {
    const res = await this.getApp().octokit.request('GET /app/installations/{installation_id}', { installation_id: installationId });
    const account = res.data.account as { login?: string; name?: string; type?: string } | null;
    return {
      accountLogin: account?.login ?? account?.name ?? 'unknown',
      accountType: account?.type === 'Organization' ? 'Organization' : 'User',
    };
  }

  async listInstallationRepos(installationId: number): Promise<string[]> {
    const octokit = await this.getApp().getInstallationOctokit(installationId);
    const out: string[] = [];
    for (let page = 1; page <= 50; page++) {
      const res = await octokit.request('GET /installation/repositories', { per_page: 100, page });
      for (const r of res.data.repositories) out.push(r.full_name);
      if (res.data.repositories.length < 100) break;
    }
    return out;
  }

  async listPullsSince(installationId: number, repo: string, opts: { since: Date; page: number; perPage: number }): Promise<{ pulls: GitHubPull[]; hasMore: boolean }> {
    const [owner, name] = splitRepo(repo);
    const octokit = await this.getApp().getInstallationOctokit(installationId);
    const res = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
      owner,
      repo: name,
      state: 'all',
      sort: 'updated',
      direction: 'desc',
      per_page: opts.perPage,
      page: opts.page,
    });
    const pulls = (res.data as unknown as RawPull[]).map(normalizePull);
    const last = pulls[pulls.length - 1];
    const hasMore = pulls.length === opts.perPage && last !== undefined && new Date(last.updatedAt) >= opts.since;
    return { pulls, hasMore };
  }

  async getPull(installationId: number, repo: string, number: number): Promise<GitHubPull> {
    const [owner, name] = splitRepo(repo);
    const octokit = await this.getApp().getInstallationOctokit(installationId);
    const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner, repo: name, pull_number: number });
    return normalizePull(res.data as unknown as RawPull);
  }

  async createIssueComment(installationId: number, repo: string, issueNumber: number, body: string): Promise<void> {
    const [owner, name] = splitRepo(repo);
    const octokit = await this.getApp().getInstallationOctokit(installationId);
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', { owner, repo: name, issue_number: issueNumber, body });
  }
}

function splitRepo(full: string): [string, string] {
  const [owner, name] = full.split('/');
  if (!owner || !name) throw validation('Invalid repository name.');
  return [owner, name];
}

// ───────────────────────────── Webhook payload shapes ─────────────────────────────

interface RepoPayload {
  full_name: string;
}
interface PullPayload {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state: string;
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  closed_at?: string | null;
  head?: { ref?: string; sha?: string };
  user?: { login?: string } | null;
}
interface WebhookPayload {
  action?: string;
  repository?: RepoPayload;
  sender?: { login?: string };
  installation?: { id: number; account?: { login?: string; type?: string }; repository_selection?: string };
  repositories?: RepoPayload[];
  repositories_added?: RepoPayload[];
  repositories_removed?: RepoPayload[];
  pull_request?: PullPayload;
  requested_reviewer?: { login?: string };
  requested_team?: { name?: string };
  review?: { state?: string; user?: { login?: string } };
  commits?: { id: string; message: string; url?: string; author?: { username?: string; name?: string } }[];
  deleted?: boolean;
  issue?: { number: number; title: string; body?: string | null; html_url?: string; labels?: { name: string }[]; pull_request?: unknown };
  label?: { name?: string };
}

const PR_ACTIONS = new Set(['opened', 'reopened', 'edited', 'synchronize', 'ready_for_review', 'converted_to_draft', 'review_requested', 'closed']);
const HANDLED: Record<string, ((action: string | undefined) => boolean) | undefined> = {
  pull_request: (a) => a !== undefined && PR_ACTIONS.has(a),
  pull_request_review: (a) => a === 'submitted',
  push: () => true,
  issues: (a) => a === 'opened' || a === 'labeled',
  installation: (a) => a === 'created' || a === 'deleted' || a === 'suspend' || a === 'unsuspend',
  installation_repositories: (a) => a === 'added' || a === 'removed',
};

type PrState = 'open' | 'closed' | 'merged' | 'draft';

interface PrInfo {
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: PrState;
  headRef: string | null;
  headSha: string | null;
  author: string | null;
  mergedAt: Date | null;
  closedAt: Date | null;
}

function prFromPayload(p: PullPayload): PrInfo {
  return prInfo({
    number: p.number,
    title: p.title,
    body: p.body ?? null,
    url: p.html_url,
    state: p.state === 'closed' ? 'closed' : 'open',
    draft: Boolean(p.draft),
    merged: Boolean(p.merged) || Boolean(p.merged_at),
    mergedAt: p.merged_at ?? null,
    closedAt: p.closed_at ?? null,
    updatedAt: '',
    headRef: p.head?.ref ?? null,
    headSha: p.head?.sha ?? null,
    author: p.user?.login ?? null,
  });
}

function prInfo(p: GitHubPull): PrInfo {
  return {
    number: p.number,
    title: p.title,
    body: p.body,
    url: p.url,
    state: p.merged ? 'merged' : p.state === 'closed' ? 'closed' : p.draft ? 'draft' : 'open',
    headRef: p.headRef,
    headSha: p.headSha,
    author: p.author,
    mergedAt: p.mergedAt ? new Date(p.mergedAt) : null,
    closedAt: p.closedAt ? new Date(p.closedAt) : null,
  };
}

interface AppliedLink {
  link: GithubLinkRow;
  issueId: string;
  created: boolean;
  prevState: PrState | null;
}

const BACKFILL_DAYS = 90;
const BACKFILL_PAGE = 50;
const PR_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)\/?(?:[?#].*)?$/;

/**
 * GitHub App integration (SPEC §6.5). Inbound webhooks are verified, deduped and enqueued by
 * `receiveWebhook` (fast, no API calls); `processEvent` runs the §6.5.2 matrix from the queue.
 */
export class GitHubService extends ServiceBase {
  protected audit!: AuditService;
  protected issueService!: IssueService;
  protected teamService!: TeamService;
  protected commentService!: CommentService;
  private apiImpl: GitHubApi | null;

  constructor(deps: ServiceDeps, api?: GitHubApi) {
    super(deps);
    this.apiImpl = api ?? null;
  }

  bind(deps: { audit: AuditService; issues: IssueService; teams: TeamService; comments: CommentService }): void {
    this.audit = deps.audit;
    this.issueService = deps.issues;
    this.teamService = deps.teams;
    this.commentService = deps.comments;
  }

  /** The GitHub API seam (lazily defaults to the Octokit-backed implementation). */
  get api(): GitHubApi {
    if (!this.apiImpl) this.apiImpl = new OctokitGitHubApi(this.config.github);
    return this.apiImpl;
  }

  setApi(api: GitHubApi): void {
    this.apiImpl = api;
  }

  isConfigured(): boolean {
    return Boolean(this.config.github.appId && this.config.github.privateKey && this.config.github.webhookSecret);
  }

  installUrl(): string | null {
    return this.config.github.appSlug ? `https://github.com/apps/${this.config.github.appSlug}/installations/new` : null;
  }

  // ───────────── Installs ─────────────

  async installs(actor: ServiceActor): Promise<GithubInstallRow[]> {
    assertCan(actor, 'workspace.integrations');
    return this.db.select().from(githubInstalls).where(isNull(githubInstalls.deletedAt)).orderBy(asc(githubInstalls.createdAt));
  }

  private async requireInstall(installId: string): Promise<GithubInstallRow> {
    const [row] = await this.db
      .select()
      .from(githubInstalls)
      .where(and(eq(githubInstalls.id, installId), isNull(githubInstalls.deletedAt)));
    if (!row) throw notFound('GitHub installation');
    return row;
  }

  async handleInstallCallback(actor: ServiceActor, installationId: number): Promise<GithubInstallRow> {
    assertCan(actor, 'workspace.integrations');
    if (!Number.isSafeInteger(installationId) || installationId <= 0) throw validation('Invalid installation id.');
    const [info, repos] = await Promise.all([this.api.getInstallation(installationId), this.api.listInstallationRepos(installationId)]);
    const settings: GithubInstallSettings = {
      accountLogin: info.accountLogin,
      accountType: info.accountType,
      repos,
      repoTeamMap: {},
      autoCloseOnMerge: true,
      issueSync: false,
      issueSyncTeamId: null,
    };
    const row = await this.tx(async (tx) => {
      const [existing] = await tx.select().from(githubInstalls).where(eq(githubInstalls.installationId, installationId));
      let r: GithubInstallRow | undefined;
      if (existing) {
        // Re-install: keep the owner's configuration, refresh account + repos.
        const merged: GithubInstallSettings = { ...existing.settings, accountLogin: info.accountLogin, accountType: info.accountType, repos };
        [r] = await tx
          .update(githubInstalls)
          .set({ settings: merged, deletedAt: null, suspendedAt: null, updatedAt: this.now() })
          .where(eq(githubInstalls.id, existing.id))
          .returning();
      } else {
        [r] = await tx.insert(githubInstalls).values({ installationId, settings }).returning();
      }
      if (!r) throw new Error('github install upsert failed');
      await this.audit.log(tx, actor, {
        action: 'github.installed',
        objectType: 'github_install',
        objectId: r.id,
        changes: { installationId, account: info.accountLogin, repos: repos.length },
      });
      return r;
    });
    await this.startBackfill(actor, row.id);
    return this.requireInstall(row.id);
  }

  async updateSettings(
    actor: ServiceActor,
    installId: string,
    patch: Partial<Omit<GithubInstallSettings, 'accountLogin' | 'accountType'>>,
  ): Promise<GithubInstallRow> {
    assertCan(actor, 'workspace.integrations');
    const install = await this.requireInstall(installId);
    const teamIds = new Set<string>(patch.repoTeamMap ? Object.values(patch.repoTeamMap) : []);
    if (patch.issueSyncTeamId) teamIds.add(patch.issueSyncTeamId);
    if (teamIds.size) {
      const found = await this.teamService.getMany([...teamIds]);
      const ok = new Set(found.filter((t) => !t.deletedAt).map((t) => t.id));
      for (const id of teamIds) if (!ok.has(id)) throw validation('That team doesn’t exist.', { field: 'teamId', teamId: id });
    }
    const next: GithubInstallSettings = { ...install.settings };
    if (patch.repos !== undefined) next.repos = patch.repos;
    if (patch.repoTeamMap !== undefined) next.repoTeamMap = patch.repoTeamMap;
    if (patch.autoCloseOnMerge !== undefined) next.autoCloseOnMerge = patch.autoCloseOnMerge;
    if (patch.issueSync !== undefined) next.issueSync = patch.issueSync;
    if (patch.issueSyncTeamId !== undefined) next.issueSyncTeamId = patch.issueSyncTeamId;
    return this.tx(async (tx) => {
      const [row] = await tx.update(githubInstalls).set({ settings: next, updatedAt: this.now() }).where(eq(githubInstalls.id, installId)).returning();
      if (!row) throw notFound('GitHub installation');
      await this.audit.log(tx, actor, { action: 'github.settings_updated', objectType: 'github_install', objectId: installId, changes: { patch } });
      return row;
    });
  }

  async uninstall(actor: ServiceActor, installId: string): Promise<void> {
    assertCan(actor, 'workspace.integrations');
    const install = await this.requireInstall(installId);
    await this.tx(async (tx) => {
      await tx
        .update(githubInstalls)
        .set({ deletedAt: this.now(), updatedAt: this.now(), backfillStatus: install.backfillStatus === 'running' ? 'canceled' : install.backfillStatus })
        .where(eq(githubInstalls.id, installId));
      await this.audit.log(tx, actor, {
        action: 'github.uninstalled',
        objectType: 'github_install',
        objectId: installId,
        changes: { account: install.settings.accountLogin },
      });
    });
  }

  // ───────────── Webhook intake ─────────────

  async receiveWebhook(input: { deliveryId: string; event: string; signature: string | null; rawBody: string }): Promise<WebhookReceipt> {
    const secret = this.config.github.webhookSecret;
    if (!secret) throw unauthenticated('GitHub webhooks are not configured.');
    if (!verifyHmacSignature(secret, input.rawBody, input.signature)) throw unauthenticated('Invalid webhook signature.');
    if (!input.deliveryId) throw validation('Missing delivery id.');
    let payload: WebhookPayload;
    try {
      const parsed: unknown = JSON.parse(input.rawBody);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      payload = parsed as WebhookPayload;
    } catch {
      throw validation('Webhook body is not valid JSON.');
    }
    const handled = HANDLED[input.event]?.(payload.action) ?? false;
    const [row] = await this.db
      .insert(githubEvents)
      .values({
        installationId: payload.installation?.id ?? null,
        eventId: input.deliveryId,
        type: input.event,
        action: payload.action ?? null,
        payload,
        status: handled ? 'pending' : 'ignored',
        ...(handled ? {} : { processedAt: this.now() }),
      })
      .onConflictDoNothing({ target: githubEvents.eventId })
      .returning({ id: githubEvents.id });
    if (!row) return { status: 'duplicate', eventRowId: null };
    if (!handled) return { status: 'ignored', eventRowId: row.id };
    await this.jobs.send('github', { type: 'process_event', eventRowId: row.id }, { retryLimit: 5, retryDelaySeconds: 30, retryBackoff: true });
    return { status: 'accepted', eventRowId: row.id };
  }

  async processEvent(eventRowId: string): Promise<void> {
    const [ev] = await this.db.select().from(githubEvents).where(eq(githubEvents.id, eventRowId));
    if (!ev) return;
    if (ev.status === 'processed' || ev.status === 'ignored') return;
    try {
      const outcome = await this.dispatch(ev.type, ev.payload as WebhookPayload);
      await this.db
        .update(githubEvents)
        .set({ status: outcome === 'ignored' ? 'ignored' : 'processed', error: null, processedAt: this.now() })
        .where(eq(githubEvents.id, eventRowId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err, eventRowId }, 'github event failed');
      await this.db.update(githubEvents).set({ status: 'failed', error: message.slice(0, 2000), processedAt: this.now() }).where(eq(githubEvents.id, eventRowId));
      throw err;
    }
  }

  private async dispatch(type: string, p: WebhookPayload): Promise<'done' | 'ignored'> {
    switch (type) {
      case 'pull_request':
        return this.onPullRequest(p);
      case 'pull_request_review':
        return this.onReview(p);
      case 'push':
        return this.onPush(p);
      case 'issues':
        return this.onIssue(p);
      case 'installation':
        return this.onInstallation(p);
      case 'installation_repositories':
        return this.onInstallationRepos(p);
      default:
        return 'ignored';
    }
  }

  // ───────────── Shared helpers ─────────────

  private async installByInstallationId(installationId: number | undefined): Promise<GithubInstallRow | null> {
    if (installationId === undefined) return null;
    const [row] = await this.db.select().from(githubInstalls).where(eq(githubInstalls.installationId, installationId));
    return row ?? null;
  }

  private async teamKeys(): Promise<{ teams: TeamRow[]; keys: string[] }> {
    const teams = await this.teamService.list(null, { includeArchived: true });
    return { teams, keys: teams.map((t) => t.key) };
  }

  /** Repo → team: explicit map, else team key ↔ repo name (uppercased alphanumerics). */
  private teamForRepo(settings: GithubInstallSettings, repo: string, teams: TeamRow[]): TeamRow | null {
    const mapped = settings.repoTeamMap[repo];
    if (mapped) {
      const t = teams.find((x) => x.id === mapped && !x.archivedAt);
      if (t) return t;
    }
    const name = (repo.split('/')[1] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const auto = name ? teams.find((t) => t.key === name && !t.archivedAt) : undefined;
    if (auto) return auto;
    if (settings.issueSyncTeamId) return teams.find((t) => t.id === settings.issueSyncTeamId && !t.archivedAt) ?? null;
    return null;
  }

  /** Resolve every issue a PR references → closes flag. Title, branch, and close-keyword body refs close. */
  private async resolvePrTargets(pr: PrInfo, keys: string[]): Promise<Map<string, { issue: IssueRow; closes: boolean }>> {
    const targets = new Map<string, { issue: IssueRow; closes: boolean }>();
    const add = async (ref: ReturnType<typeof findIssueReferences>[number], closes: boolean): Promise<void> => {
      const issue = ref.kind === 'identifier' ? await this.issueService.getByIdentifier(ref.identifier) : await this.issueService.get(ref.issueId);
      if (!issue || issue.trashedAt) return;
      const prev = targets.get(issue.id);
      targets.set(issue.id, { issue, closes: (prev?.closes ?? false) || closes });
    };
    const opts = { appUrl: this.config.appUrl };
    for (const r of findIssueReferences(pr.title, keys, opts)) await add(r, true);
    if (pr.headRef) for (const r of extractIssueRefsFromBranch(pr.headRef, keys)) await add(r, true);
    if (pr.body) for (const r of findIssueReferences(pr.body, keys, opts)) await add(r, r.kind === 'identifier' && r.closes);
    return targets;
  }

  /**
   * Upsert links for every issue the PR references. On first link, and when a link first
   * becomes merged/closed, writes an activity row and (when `notify`) publishes `github.linked`.
   * Plain edits only refresh the link row.
   */
  private async applyPr(repo: string, pr: PrInfo, notify: boolean): Promise<AppliedLink[]> {
    const { keys } = await this.teamKeys();
    const targets = await this.resolvePrTargets(pr, keys);
    const applied: AppliedLink[] = [];
    for (const { issue, closes } of targets.values()) {
      applied.push(await this.tx((tx) => this.upsertPrLink(tx, issue.id, repo, pr, closes, notify)));
    }
    return applied;
  }

  private async upsertPrLink(tx: Tx, issueId: string, repo: string, pr: PrInfo, closes: boolean, notify: boolean): Promise<AppliedLink> {
    const now = this.now();
    const selectExisting = async (): Promise<GithubLinkRow | undefined> => {
      const [r] = await tx
        .select()
        .from(githubLinks)
        .where(and(eq(githubLinks.issueId, issueId), eq(githubLinks.repo, repo), eq(githubLinks.prNumber, pr.number), eq(githubLinks.kind, 'pr')));
      return r;
    };
    const values = {
      title: pr.title,
      prUrl: pr.url,
      author: pr.author,
      headBranch: pr.headRef,
      commitSha: null,
    };
    let existing = await selectExisting();
    let link: GithubLinkRow | undefined;
    let created = false;
    if (!existing) {
      const [ins] = await tx
        .insert(githubLinks)
        .values({
          issueId,
          kind: 'pr',
          repo,
          prNumber: pr.number,
          ...values,
          prState: pr.state,
          closesIssue: closes,
          mergedAt: pr.mergedAt,
          closedAt: pr.state === 'closed' || pr.state === 'merged' ? (pr.closedAt ?? now) : null,
        })
        .onConflictDoNothing()
        .returning();
      if (ins) {
        link = ins;
        created = true;
      } else {
        existing = await selectExisting();
      }
    }
    if (!link) {
      if (!existing) throw new Error('github link upsert failed');
      // A stale/out-of-order event must not move a merged PR back to open.
      const state: PrState = existing.prState === 'merged' && pr.state !== 'merged' ? 'merged' : pr.state;
      const [upd] = await tx
        .update(githubLinks)
        .set({
          ...values,
          prState: state,
          closesIssue: existing.closesIssue || closes,
          mergedAt: pr.mergedAt ?? existing.mergedAt,
          closedAt: state === 'closed' || state === 'merged' ? (existing.closedAt ?? pr.closedAt ?? now) : null,
          updatedAt: now,
        })
        .where(eq(githubLinks.id, existing.id))
        .returning();
      link = upd;
    }
    if (!link) throw new Error('github link upsert failed');
    const prevState = existing?.prState ?? null;
    const newState = link.prState ?? pr.state;
    const transitionedToEnd = (newState === 'merged' || newState === 'closed') && prevState !== newState;
    if (created || transitionedToEnd) {
      await this.activity(tx, issueId, 'github_pr', { repo, number: pr.number, title: pr.title, url: pr.url, state: newState });
      if (notify) await publish(tx, 'github.linked', { issueId, linkId: link.id, repo, prNumber: pr.number, state: newState });
    }
    return { link, issueId, created, prevState };
  }

  private async activity(tx: Tx, issueId: string, type: string, toValue: Record<string, unknown>, actor?: ServiceActor): Promise<void> {
    await tx.insert(issueActivity).values({
      issueId,
      actorUserId: actor ? actorUserId(actor) : null,
      actorKind: actor ? actor.kind : 'github',
      type,
      toValue,
    });
  }

  private effectiveAutoClose(link: GithubLinkRow, install: GithubInstallRow | null): boolean {
    return link.autoClose ?? install?.settings.autoCloseOnMerge ?? true;
  }

  private async autoCloseOnMerge(applied: AppliedLink[], install: GithubInstallRow | null): Promise<void> {
    for (const a of applied) {
      if (a.link.prState !== 'merged' || a.prevState === 'merged') continue;
      if (!a.link.closesIssue || !this.effectiveAutoClose(a.link, install)) continue;
      const issue = await this.issueService.get(a.issueId);
      if (!issue || issue.trashedAt) continue;
      const current = await this.teamService.getStatus(issue.statusId);
      if (current && (current.category === 'done' || current.category === 'canceled')) continue;
      const done = await this.teamService.firstStatusOfCategory(issue.teamId, 'done');
      if (!done) continue;
      await this.issueService.update(systemActor('github'), issue.id, { statusId: done.id });
    }
  }

  // ───────────── §6.5.2 handlers ─────────────

  private async onPullRequest(p: WebhookPayload): Promise<'done' | 'ignored'> {
    if (!p.pull_request || !p.repository) return 'ignored';
    const repo = p.repository.full_name;
    const pr = prFromPayload(p.pull_request);
    const install = await this.installByInstallationId(p.installation?.id);
    switch (p.action) {
      case 'review_requested': {
        const reviewer = p.requested_reviewer?.login ?? p.requested_team?.name ?? null;
        await this.reviewActivity(repo, pr, 'review_requested', reviewer);
        return 'done';
      }
      case 'closed': {
        const applied = await this.applyPr(repo, pr, true);
        if (pr.state === 'merged') await this.autoCloseOnMerge(applied, install);
        return 'done';
      }
      default:
        await this.applyPr(repo, pr, true);
        return 'done';
    }
  }

  private async onReview(p: WebhookPayload): Promise<'done' | 'ignored'> {
    if (!p.pull_request || !p.repository) return 'ignored';
    if (p.review?.state?.toLowerCase() !== 'changes_requested') return 'ignored';
    await this.reviewActivity(p.repository.full_name, prFromPayload(p.pull_request), 'changes_requested', p.review.user?.login ?? null);
    return 'done';
  }

  /** Review activity + notification for every issue already linked to the PR. */
  private async reviewActivity(repo: string, pr: PrInfo, state: 'review_requested' | 'changes_requested', who: string | null): Promise<void> {
    const links = await this.db
      .select()
      .from(githubLinks)
      .where(and(eq(githubLinks.kind, 'pr'), eq(githubLinks.repo, repo), eq(githubLinks.prNumber, pr.number)));
    for (const link of links) {
      await this.tx(async (tx) => {
        await this.activity(tx, link.issueId, 'github_review', { repo, number: pr.number, title: pr.title, url: pr.url, state, by: who });
        await publish(tx, 'github.linked', { issueId: link.issueId, linkId: link.id, repo, prNumber: pr.number, state });
      });
    }
  }

  private async onPush(p: WebhookPayload): Promise<'done' | 'ignored'> {
    if (!p.repository || !p.commits?.length || p.deleted) return 'ignored';
    const repo = p.repository.full_name;
    const { keys } = await this.teamKeys();
    for (const c of p.commits) {
      const author = c.author?.username ?? c.author?.name ?? p.sender?.login ?? null;
      for (const ref of findIssueReferences(c.message, keys, { appUrl: this.config.appUrl })) {
        // Any identifier reference links the commit (SPEC §6.5.1); commits never close issues.
        if (ref.kind !== 'identifier') continue;
        const issue = await this.issueService.getByIdentifier(ref.identifier);
        if (!issue || issue.trashedAt) continue;
        await this.tx(async (tx) => {
          const [link] = await tx
            .insert(githubLinks)
            .values({
              issueId: issue.id,
              kind: 'commit',
              repo,
              commitSha: c.id,
              title: c.message.split('\n')[0]?.slice(0, 300) ?? null,
              prUrl: c.url ?? null,
              author,
              closesIssue: false,
            })
            .onConflictDoNothing()
            .returning();
          if (!link) return;
          await this.activity(tx, issue.id, 'github_commit', { repo, sha: c.id, message: c.message.split('\n')[0]?.slice(0, 300), url: c.url ?? null, author, state: 'commit' });
          await publish(tx, 'github.linked', { issueId: issue.id, linkId: link.id, repo, prNumber: null, state: 'commit' });
        });
      }
    }
    return 'done';
  }

  private async onIssue(p: WebhookPayload): Promise<'done' | 'ignored'> {
    const gh = p.issue;
    if (!gh || !p.repository || !p.installation) return 'ignored';
    if (gh.pull_request) return 'ignored';
    const install = await this.installByInstallationId(p.installation.id);
    if (!install || install.deletedAt || !install.settings.issueSync) return 'ignored';
    const hasLabel = (gh.labels ?? []).some((l) => l.name.toLowerCase() === 'velocity');
    if (!hasLabel) return 'ignored';
    if (p.action === 'labeled' && p.label?.name?.toLowerCase() !== 'velocity') return 'ignored';
    const repo = p.repository.full_name;
    const { teams } = await this.teamKeys();
    const team = this.teamForRepo(install.settings, repo, teams);
    if (!team) return 'ignored';

    const created = await this.tx(async (tx) => {
      // Serialize concurrent deliveries for the same GitHub issue, then dedupe on the marker.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ghsync:${repo}#${gh.number}`}))`);
      const dup = await tx
        .select({ id: issueActivity.id })
        .from(issueActivity)
        .where(and(eq(issueActivity.type, 'github_issue_sync'), sql`${issueActivity.toValue}->>'repo' = ${repo}`, sql`(${issueActivity.toValue}->>'number')::int = ${gh.number}`))
        .limit(1);
      if (dup.length) return null;
      const issue = await this.issueService.createInTx(tx, systemActor('github'), {
        teamId: team.id,
        title: gh.title.slice(0, 500) || `GitHub issue #${gh.number}`,
        descriptionMd: gh.body ?? null,
      });
      await this.activity(tx, issue.id, 'github_issue_sync', { repo, number: gh.number, url: gh.html_url ?? null });
      return { issue, identifier: `${team.key}-${issue.number}` };
    });
    if (!created) return 'done';
    const base = this.config.appUrl.replace(/\/+$/, '');
    try {
      await this.api.createIssueComment(p.installation.id, repo, gh.number, `Tracked in Velocity as ${created.identifier}: ${base}/issue/${created.issue.id}`);
    } catch (err) {
      // The issue exists and is marked as synced; a redelivery must not duplicate it, so don't fail the event.
      this.logger.warn({ err, repo, number: gh.number }, 'github back-link comment failed');
    }
    return 'done';
  }

  private async onInstallation(p: WebhookPayload): Promise<'done' | 'ignored'> {
    const inst = p.installation;
    if (!inst) return 'ignored';
    const now = this.now();
    switch (p.action) {
      case 'created': {
        const repos = (p.repositories ?? []).map((r) => r.full_name);
        const settings: GithubInstallSettings = {
          accountLogin: inst.account?.login ?? 'unknown',
          accountType: inst.account?.type === 'Organization' ? 'Organization' : 'User',
          repos,
          repoTeamMap: {},
          autoCloseOnMerge: true,
          issueSync: false,
          issueSyncTeamId: null,
        };
        const existing = await this.installByInstallationId(inst.id);
        if (existing) {
          await this.db
            .update(githubInstalls)
            .set({ deletedAt: null, suspendedAt: null, updatedAt: now, settings: { ...existing.settings, accountLogin: settings.accountLogin, accountType: settings.accountType, repos: repos.length ? repos : existing.settings.repos } })
            .where(eq(githubInstalls.id, existing.id));
        } else {
          await this.db.insert(githubInstalls).values({ installationId: inst.id, settings }).onConflictDoNothing();
        }
        return 'done';
      }
      case 'deleted':
        await this.db.update(githubInstalls).set({ deletedAt: now, updatedAt: now }).where(eq(githubInstalls.installationId, inst.id));
        return 'done';
      case 'suspend':
        await this.db.update(githubInstalls).set({ suspendedAt: now, updatedAt: now }).where(eq(githubInstalls.installationId, inst.id));
        return 'done';
      case 'unsuspend':
        await this.db.update(githubInstalls).set({ suspendedAt: null, updatedAt: now }).where(eq(githubInstalls.installationId, inst.id));
        return 'done';
      default:
        return 'ignored';
    }
  }

  private async onInstallationRepos(p: WebhookPayload): Promise<'done' | 'ignored'> {
    if (!p.installation) return 'ignored';
    const install = await this.installByInstallationId(p.installation.id);
    if (!install) return 'ignored';
    const repos = new Set(install.settings.repos);
    for (const r of p.repositories_added ?? []) repos.add(r.full_name);
    for (const r of p.repositories_removed ?? []) repos.delete(r.full_name);
    await this.db
      .update(githubInstalls)
      .set({ settings: { ...install.settings, repos: [...repos].sort() }, updatedAt: this.now() })
      .where(eq(githubInstalls.id, install.id));
    return 'done';
  }

  // ───────────── Backfill (§6.5.1) ─────────────

  async startBackfill(actor: ServiceActor, installId: string): Promise<void> {
    assertCan(actor, 'workspace.integrations');
    await this.requireInstall(installId);
    await this.db.update(githubInstalls).set({ backfillStatus: 'running', backfillProgress: 0, updatedAt: this.now() }).where(eq(githubInstalls.id, installId));
    await this.jobs.send('github', { type: 'backfill', installId });
  }

  async cancelBackfill(actor: ServiceActor, installId: string): Promise<void> {
    assertCan(actor, 'workspace.integrations');
    await this.requireInstall(installId);
    await this.db
      .update(githubInstalls)
      .set({ backfillStatus: 'canceled', updatedAt: this.now() })
      .where(and(eq(githubInstalls.id, installId), eq(githubInstalls.backfillStatus, 'running')));
  }

  /**
   * Job: link PRs updated in the last 90 days. Uses the same linking logic as webhooks but
   * publishes no `github.linked` events (no notification flood) and never auto-closes issues.
   */
  async runBackfill(installId: string): Promise<void> {
    const [install] = await this.db.select().from(githubInstalls).where(and(eq(githubInstalls.id, installId), isNull(githubInstalls.deletedAt)));
    if (!install) return;
    const isCanceled = async (): Promise<boolean> => {
      const [cur] = await this.db.select({ s: githubInstalls.backfillStatus }).from(githubInstalls).where(eq(githubInstalls.id, installId));
      return !cur || cur.s !== 'running';
    };
    const setProgress = (progress: number): Promise<unknown> =>
      this.db
        .update(githubInstalls)
        .set({ backfillProgress: Math.max(0, Math.min(1, progress)) })
        .where(and(eq(githubInstalls.id, installId), eq(githubInstalls.backfillStatus, 'running')));
    try {
      const since = new Date(this.now().getTime() - BACKFILL_DAYS * 86_400_000);
      const repos = install.settings.repos;
      for (let i = 0; i < repos.length; i++) {
        const repo = repos[i] as string;
        for (let page = 1; ; page++) {
          if (await isCanceled()) return;
          const res = await this.api.listPullsSince(install.installationId, repo, { since, page, perPage: BACKFILL_PAGE });
          let reachedOld = false;
          for (const pull of res.pulls) {
            if (new Date(pull.updatedAt) < since) {
              reachedOld = true;
              break;
            }
            await this.applyPr(repo, prInfo(pull), false);
          }
          const more = res.hasMore && !reachedOld;
          // Page count per repo is unknown up front; approach the repo's share asymptotically.
          const within = more ? 1 - 1 / (page + 1) : 1;
          await setProgress((i + within) / repos.length);
          if (!more) break;
        }
      }
      if (await isCanceled()) return;
      await this.db
        .update(githubInstalls)
        .set({ backfillStatus: 'done', backfillProgress: 1, updatedAt: this.now() })
        .where(and(eq(githubInstalls.id, installId), eq(githubInstalls.backfillStatus, 'running')));
    } catch (err) {
      this.logger.error({ err, installId }, 'github backfill failed');
      await this.db.update(githubInstalls).set({ backfillStatus: 'failed', updatedAt: this.now() }).where(eq(githubInstalls.id, installId));
    }
  }

  // ───────────── Manual links ─────────────

  async linkPullRequest(actor: ServiceActor, issueId: string, url: string): Promise<GithubLinkRow> {
    assertCan(actor, 'issue.write');
    const m = PR_URL_RE.exec(url.trim());
    if (!m) throw validation('Paste a pull request URL like https://github.com/owner/repo/pull/123.', { field: 'url' });
    const repo = `${m[1]}/${m[2]}`;
    const number = Number(m[3]);
    if (!Number.isSafeInteger(number) || number < 1) throw validation('Invalid pull request number.', { field: 'url' });
    const issue = await this.issueService.require(issueId);
    if (issue.trashedAt) throw notFound('Issue');

    let pr: PrInfo = {
      number,
      title: `${repo}#${number}`,
      body: null,
      url: `https://github.com/${repo}/pull/${number}`,
      state: 'open',
      headRef: null,
      headSha: null,
      author: null,
      mergedAt: null,
      closedAt: null,
    };
    const installs = await this.db.select().from(githubInstalls).where(and(isNull(githubInstalls.deletedAt), isNull(githubInstalls.suspendedAt)));
    const install = installs.find((i) => i.settings.repos.some((r) => r.toLowerCase() === repo.toLowerCase()));
    if (install) {
      try {
        pr = prInfo(await this.api.getPull(install.installationId, repo, number));
      } catch (err) {
        this.logger.warn({ err, repo, number }, 'github getPull failed; storing minimal link');
      }
    }
    const applied = await this.tx(async (tx) => {
      const a = await this.upsertPrLink(tx, issue.id, repo, pr, true, false);
      if (a.created) await this.activity(tx, issue.id, 'github_pr_manual', { repo, number, title: pr.title, url: pr.url, state: pr.state }, actor);
      return a;
    });
    return applied.link;
  }

  async unlink(actor: ServiceActor, linkId: string): Promise<void> {
    assertCan(actor, 'issue.write');
    await this.tx(async (tx) => {
      const [link] = await tx.delete(githubLinks).where(eq(githubLinks.id, linkId)).returning();
      if (!link) throw notFound('Link');
      await this.activity(tx, link.issueId, 'github_unlinked', { repo: link.repo, number: link.prNumber, sha: link.commitSha, url: link.prUrl }, actor);
    });
  }

  /** Per-link override of the install's auto-close setting; `null` inherits. */
  async setAutoClose(actor: ServiceActor, linkId: string, autoClose: boolean | null): Promise<GithubLinkRow> {
    assertCan(actor, 'issue.write');
    const [row] = await this.db.update(githubLinks).set({ autoClose, updatedAt: this.now() }).where(eq(githubLinks.id, linkId)).returning();
    if (!row) throw notFound('Link');
    return row;
  }

  async linksFor(issueIds: readonly string[]): Promise<GithubLinkRow[]> {
    if (!issueIds.length) return [];
    return this.db
      .select()
      .from(githubLinks)
      .where(inArray(githubLinks.issueId, [...issueIds]))
      .orderBy(desc(githubLinks.createdAt));
  }
}
