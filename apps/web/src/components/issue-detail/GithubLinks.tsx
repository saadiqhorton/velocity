import { useState } from 'react';
import { Button, Icon, IconButton, Lozenge, Switch, TextField } from '@velocity/ui';
import { LinkPullRequestDocument, SetGithubLinkAutoCloseDocument, UnlinkGithubDocument } from '@/gql/graphql';
import type { GithubLinkFieldsFragment } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { formatRelative } from '@/lib/format';
import type { DetailIssue } from './IssueDetail';
import { m } from '@/i18n';

function stateAppearance(link: GithubLinkFieldsFragment): { label: string; appearance: 'success' | 'new' | 'removed' | 'default' } {
  if (link.mergedAt) return { label: m.github.merged, appearance: 'new' };
  if (link.state === 'closed') return { label: m.github.closed, appearance: 'removed' };
  if (link.kind === 'commit') return { label: m.github.commit, appearance: 'default' };
  return { label: m.github.open, appearance: 'success' };
}

/** GitHub tab: linked PRs/commits, per-link close-on-merge, manual link (SPEC §6.5). */
export function GithubLinks({ issue }: { issue: DetailIssue }) {
  const [url, setUrl] = useState('');
  const [link, { loading }] = useOptimisticMutation(LinkPullRequestDocument, {
    optimistic: { serverConfirmed: 'The server resolves the PR from GitHub before it can be shown.' },
    rollback: () => m.flags.rollback.generic,
    refetchQueries: ['IssueDetail'],
  });
  const [unlink] = useOptimisticMutation(UnlinkGithubDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, unlinkGithub: true }),
    rollback: () => m.flags.rollback.generic,
    update: (cache, _r, vars) =>
      cache.modify({
        id: cache.identify({ __typename: 'Issue' as const, id: issue.id }),
        fields: { githubLinks: (existing: readonly { __ref: string }[] = [], { readField }) => existing.filter((l) => readField('id', l) !== vars.linkId) },
      }),
  });
  const [setAuto] = useOptimisticMutation(SetGithubLinkAutoCloseDocument, {
    optimistic: (vars) => ({ __typename: 'Mutation' as const, setGithubLinkAutoClose: { __typename: 'GithubLink' as const, id: vars.linkId, autoClose: vars.autoClose ?? null } }),
    rollback: () => m.flags.rollback.generic,
  });

  return (
    <div className="flex flex-col gap-3" data-testid="github-links">
      {issue.githubLinks.length === 0 ? <p className="text-base text-fg-subtlest">{m.issue.noGithub}</p> : null}
      {issue.githubLinks.map((l) => {
        const st = stateAppearance(l);
        return (
          <div key={l.id} className="flex flex-col gap-1 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <Icon name="github" className="text-fg-subtle" />
              <a href={l.url ?? '#'} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-base font-medium text-fg hover:underline">
                {l.title ?? l.commitSha?.slice(0, 7) ?? l.repo}
              </a>
              <Lozenge appearance={st.appearance}>{st.label}</Lozenge>
              <IconButton label={m.issue.unlink} size="sm" icon={<Icon name="close" />} onClick={() => void unlink({ linkId: l.id })} />
            </div>
            <div className="flex items-center gap-2 text-sm text-fg-subtlest">
              <span className="font-mono">
                {l.repo}
                {l.prNumber ? `#${l.prNumber}` : ''}
              </span>
              {l.author ? <span>· {l.author}</span> : null}
              <span>· {formatRelative(l.createdAt)}</span>
              <span className="flex-1" />
              {l.kind === 'pull_request' || l.prNumber ? (
                <Switch
                  label={m.issue.autoClose}
                  checked={l.autoClose ?? l.closesIssue}
                  onChange={(v) => void setAuto({ linkId: l.id, autoClose: v })}
                />
              ) : null}
            </div>
          </div>
        );
      })}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim()) return;
          void link({ issueId: issue.id, url: url.trim() }).then((r) => {
            if (r.data) setUrl('');
          });
        }}
      >
        <div className="min-w-0 flex-1">
          <TextField label={m.issue.prUrl} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/org/repo/pull/123" size="sm" />
        </div>
        <Button type="submit" size="sm" loading={loading} disabled={!url.trim()}>
          {m.issue.linkPr}
        </Button>
      </form>
    </div>
  );
}
