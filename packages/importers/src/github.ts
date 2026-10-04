import type { ImportBundle, ImportComment, ImportIssue } from '@velocity/schema';
import { suggestTeamKey } from './infer';
import { Collector, parseDate } from './util';

export interface GithubFetchOptions {
  token: string;
  repos: string[];
  fetch?: typeof fetch;
  onProgress?: (done: number, total?: number) => void;
}

interface GhUser {
  login: string;
}
interface GhLabel {
  name: string;
}
interface GhMilestone {
  number: number;
  title: string;
  due_on?: string | null;
}
interface GhIssue {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  state_reason?: string | null;
  user?: GhUser | null;
  assignee?: GhUser | null;
  assignees?: GhUser[] | null;
  labels?: (GhLabel | string)[];
  milestone?: GhMilestone | null;
  comments?: number;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  pull_request?: unknown;
}
interface GhComment {
  id: number;
  body?: string | null;
  user?: GhUser | null;
  created_at?: string;
}

const API = 'https://api.github.com';

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m) return m[1] ?? null;
  }
  return null;
}

/** Fetch issues (not PRs), comments and milestones of the given repos from the GitHub REST API. */
export async function fetchGithubIssues(opts: GithubFetchOptions): Promise<ImportBundle> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const c = new Collector();
  const takenKeys = new Set<string>();
  let rateRemaining: number | null = null;
  let rateReset: string | null = null;
  let done = 0;

  const rateError = (): Error =>
    new Error(
      `GitHub API rate limit exhausted${rateReset ? `; it resets at ${rateReset}` : ''}. Try again after the reset time.`,
    );

  async function getPages<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = path.startsWith('http') ? path : `${API}${path}`;
    while (url) {
      if (rateRemaining === 0) throw rateError();
      const res: Response = await doFetch(url, {
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'velocity-importer',
        },
      });
      const rem = res.headers.get('x-ratelimit-remaining');
      const reset = res.headers.get('x-ratelimit-reset');
      if (rem !== null && rem !== '') rateRemaining = Number(rem);
      if (reset && Number.isFinite(Number(reset))) rateReset = new Date(Number(reset) * 1000).toISOString();
      if (!res.ok) {
        if (res.status === 429 || (res.status === 403 && (rateRemaining === 0 || res.headers.get('retry-after')))) {
          throw rateError();
        }
        if (res.status === 401) throw new Error('GitHub rejected the token (401 Unauthorized)');
        if (res.status === 404) throw new Error(`GitHub resource not found or not accessible with this token: ${url}`);
        throw new Error(`GitHub API request failed (${res.status}) for ${url}`);
      }
      const data: unknown = await res.json();
      if (Array.isArray(data)) out.push(...(data as T[]));
      url = nextLink(res.headers.get('link'));
    }
    return out;
  }

  for (const repoFull of opts.repos) {
    const m = /^([\w.-]+)\/([\w.-]+)$/.exec(repoFull.trim());
    if (!m) throw new Error(`Invalid repository "${repoFull}"; expected owner/repo`);
    const owner = m[1] ?? '';
    const repo = m[2] ?? '';
    const full = `${owner}/${repo}`;

    const key = suggestTeamKey(repo, takenKeys);
    takenKeys.add(key);
    c.teams.set(full, { externalId: full, key, name: repo });

    const milestones = await getPages<GhMilestone>(`/repos/${full}/milestones?state=all&per_page=100`);
    if (milestones.length) {
      c.projects.set(full, {
        externalId: full,
        name: repo,
        milestones: milestones.map((ms) => ({
          externalId: `${full}/milestones/${ms.number}`,
          name: ms.title,
          targetDate: parseDate(ms.due_on),
        })),
      });
    }

    const items = await getPages<GhIssue>(`/repos/${full}/issues?state=all&per_page=100`);
    for (const gi of items) {
      if (gi.pull_request) continue;
      const ext = `${full}#${gi.number}`;
      let statusName = 'Todo';
      let category: 'todo' | 'done' | 'canceled' = 'todo';
      if (gi.state === 'closed') {
        if (gi.state_reason === 'not_planned') {
          statusName = 'Canceled';
          category = 'canceled';
        } else {
          statusName = 'Done';
          category = 'done';
        }
      }
      c.addStatus({ teamExternalId: full, name: statusName, category });

      const addUser = (u: GhUser | null | undefined): string | null => {
        if (!u?.login) return null;
        c.addUser({ externalId: u.login, name: u.login, username: u.login });
        return u.login;
      };
      const assignee = addUser(gi.assignees?.[0] ?? gi.assignee);
      const creator = addUser(gi.user);
      for (const extra of gi.assignees?.slice(1) ?? []) addUser(extra);

      const labelNames = (gi.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean);
      for (const l of labelNames) c.addLabel(l);

      const comments: ImportComment[] = [];
      if ((gi.comments ?? 0) > 0) {
        for (const gc of await getPages<GhComment>(`/repos/${full}/issues/${gi.number}/comments?per_page=100`)) {
          const author = addUser(gc.user);
          comments.push({
            externalId: String(gc.id),
            authorExternalId: author,
            authorName: author,
            bodyMd: gc.body ?? '',
            createdAt: parseDate(gc.created_at),
          });
        }
      }

      const issue: ImportIssue = {
        externalId: ext,
        teamExternalId: full,
        title: gi.title,
        descriptionMd: gi.body || null,
        statusName,
        priority: null,
        estimate: null,
        assigneeExternalId: assignee,
        creatorExternalId: creator,
        labelNames: [...new Set(labelNames)].slice(0, 10),
        projectExternalId: gi.milestone && milestones.length ? full : null,
        milestoneExternalId: gi.milestone && milestones.length ? `${full}/milestones/${gi.milestone.number}` : null,
        cycleExternalId: null,
        parentExternalId: null,
        relations: [],
        comments,
        createdAt: parseDate(gi.created_at),
        updatedAt: parseDate(gi.updated_at),
        completedAt: category === 'done' ? parseDate(gi.closed_at) : null,
        canceledAt: category === 'canceled' ? parseDate(gi.closed_at) : null,
        archivedAt: null,
        attachments: [],
      };
      c.issues.push(issue);
      opts.onProgress?.(++done);
    }
  }
  return c.toBundle('github');
}
