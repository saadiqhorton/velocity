import { useCallback } from 'react';
import { useApolloClient } from '@apollo/client';
import type { ApolloClient } from '@apollo/client';
import { useFlags } from '@velocity/ui';
import { IssueCommentsDocument, IssueDetailDocument } from '@/gql/graphql';
import type { IssueCommentsQuery, IssueDetailQuery } from '@/gql/graphql';
import { readIssueRow } from '@/lib/issueCache';
import { copyText } from '@/lib/clipboard';
import { branchName, buildIssuePrompt } from '@/lib/prompt';
import type { PromptComment } from '@/lib/prompt';
import { formatRelative } from '@/lib/format';
import { openDeepLink, planLaunch } from '@/lib/launch';
import { useCodingTools } from '@/stores/codingTools';
import type { CodingTool } from '@/stores/codingTools';
import { m } from '@/i18n';

type Detail = NonNullable<IssueDetailQuery['issue']>;

/** `${APP_URL}/issue/<uuid>`: the app is served from APP_URL, and the UUID survives team moves. */
export function issueLink(id: string): string {
  return `${window.location.origin}/issue/${id}`;
}

function commentsOf(data: IssueCommentsQuery | null | undefined): PromptComment[] {
  return (data?.issue?.comments ?? []).map((c) => ({ author: c.author?.name ?? c.authorName ?? m.common.unknown, createdAt: c.createdAt, bodyMd: c.bodyMd }));
}

function complete(issue: Detail | null | undefined): issue is Detail {
  return Boolean(issue && typeof issue.descriptionMd === 'string' && Array.isArray(issue.children));
}

function promptFrom(issue: Detail, comments: PromptComment[], instructions: string): string {
  return buildIssuePrompt({ ...issue, url: issueLink(issue.id) }, { comments, instructions, relative: (iso) => formatRelative(iso) });
}

/** From the cache only, so a deep link can open inside the click's user activation. */
function readPrompt(client: ApolloClient<unknown>, id: string, instructions: string): { issue: Detail; prompt: string } | null {
  const detail = client.readQuery({ query: IssueDetailDocument, variables: { id } });
  const comments = client.readQuery({ query: IssueCommentsDocument, variables: { id } });
  if (!complete(detail?.issue) || !comments?.issue) return null;
  return { issue: detail.issue, prompt: promptFrom(detail.issue, commentsOf(comments), instructions) };
}

async function fetchPrompt(client: ApolloClient<unknown>, id: string, instructions: string): Promise<{ issue: Detail; prompt: string }> {
  const cached = readPrompt(client, id, instructions);
  if (cached) return cached;
  const [detail, comments] = await Promise.all([
    client.query({ query: IssueDetailDocument, variables: { id } }),
    client.query({ query: IssueCommentsDocument, variables: { id } }),
  ]);
  const issue = detail.data.issue;
  if (!complete(issue)) throw new Error('issue not found');
  return { issue, prompt: promptFrom(issue, commentsOf(comments.data), instructions) };
}

/** Identifier and title, from the cached row when possible. */
async function fetchBasics(client: ApolloClient<unknown>, id: string): Promise<{ id: string; identifier: string; title: string }> {
  const row = readIssueRow(client.cache, id);
  if (row) return row;
  const { data } = await client.query({ query: IssueDetailDocument, variables: { id } });
  if (!data.issue) throw new Error('issue not found');
  return data.issue;
}

/**
 * Copy actions and "Open in" (Roadmap v1.2 U2/U3). Every action shows a flag saying what
 * was copied or launched, and a failure flag when the clipboard or the query fails.
 */
export function useIssueAi() {
  const client = useApolloClient() as ApolloClient<unknown>;
  const { showFlag } = useFlags();

  const done = useCallback(
    (ok: boolean, title: string, description?: string) =>
      showFlag(ok ? { title, description, severity: 'success' } : { title: m.ai.copyFailed, severity: 'error' }),
    [showFlag],
  );

  const copyPrompt = useCallback(
    async (id: string) => {
      const instructions = useCodingTools.getState().instructions;
      const pending = fetchPrompt(client, id, instructions);
      pending.catch(() => undefined);
      const ok = await copyText(pending.then((p) => p.prompt));
      try {
        const { issue } = await pending;
        done(ok, m.ai.copiedPrompt(issue.identifier));
      } catch {
        showFlag({ title: m.ai.promptFailed, severity: 'error' });
      }
    },
    [client, done, showFlag],
  );

  const copyBasic = useCallback(
    async (id: string, kind: 'branch' | 'id' | 'link') => {
      const pending = fetchBasics(client, id);
      pending.catch(() => undefined);
      const text = pending.then((r) => (kind === 'branch' ? branchName(r.identifier, r.title) : kind === 'id' ? r.identifier : issueLink(r.id)));
      text.catch(() => undefined);
      const ok = await copyText(text);
      try {
        const r = await pending;
        const title = kind === 'branch' ? m.ai.copiedBranch(await text) : kind === 'id' ? m.ai.copiedId(r.identifier) : m.ai.copiedLink(r.identifier);
        done(ok, title);
      } catch {
        showFlag({ title: m.ai.promptFailed, severity: 'error' });
      }
    },
    [client, done, showFlag],
  );

  const launch = useCallback(
    async (tool: CodingTool, id: string) => {
      const instructions = useCodingTools.getState().instructions;
      const planFor = (issue: Detail, prompt: string) =>
        planLaunch(tool, { prompt, id: issue.identifier, branch: branchName(issue.identifier, issue.title), url: issueLink(issue.id) });
      const report = (ok: boolean, reason: 'command' | 'too-long') =>
        reason === 'command' ? done(ok, m.ai.commandCopied(tool.name), m.ai.commandCopiedHint) : done(ok, m.ai.promptTooLong(tool.name), m.ai.promptTooLongHint);

      if (tool.kind === 'command') {
        // Hand the clipboard a pending text inside the click (Safari needs the gesture).
        const pending = fetchPrompt(client, id, instructions).then(({ issue, prompt }) => planFor(issue, prompt));
        pending.catch(() => undefined);
        const ok = await copyText(pending.then((p) => (p.type === 'copy' ? p.text : '')));
        try {
          await pending;
          report(ok, 'command');
        } catch {
          showFlag({ title: m.ai.promptFailed, severity: 'error' });
        }
        return;
      }

      // Deep links open from the cache when possible, so the click still counts as the gesture.
      let built: { issue: Detail; prompt: string };
      try {
        built = readPrompt(client, id, instructions) ?? (await fetchPrompt(client, id, instructions));
      } catch {
        showFlag({ title: m.ai.promptFailed, severity: 'error' });
        return;
      }
      const plan = planFor(built.issue, built.prompt);
      if (plan.type === 'open') {
        openDeepLink(plan.url);
        showFlag({ title: m.ai.openedIn(tool.name), severity: 'success' });
        return;
      }
      report(await copyText(plan.text), plan.reason);
    },
    [client, done, showFlag],
  );

  return {
    copyPrompt,
    copyBranch: (id: string) => copyBasic(id, 'branch'),
    copyId: (id: string) => copyBasic(id, 'id'),
    copyLink: (id: string) => copyBasic(id, 'link'),
    launch,
  };
}
