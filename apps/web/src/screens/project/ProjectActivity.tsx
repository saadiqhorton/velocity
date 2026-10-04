import { useQuery } from '@apollo/client';
import { Avatar, EmptyState, InlineMessage, Skeleton, StatusIcon } from '@velocity/ui';
import { IssueListDocument } from '@/gql/graphql';
import { useOpenIssue } from '@/lib/navigation';
import { formatRelative } from '@/lib/format';
import { describeError } from '@/lib/errors';
import { m } from '@/i18n';

/** Recently updated issues in the project (the API exposes no per-project event feed). */
export function ProjectActivity({ projectId }: { projectId: string }) {
  const open = useOpenIssue();
  const { data, loading, error } = useQuery(IssueListDocument, {
    variables: { projectId, ordering: 'updated', first: 30, includeSubIssues: true },
  });
  const issues = data?.issues.nodes ?? [];
  return (
    <div className="mx-auto flex max-w-240 flex-col gap-2 p-5" data-testid="project-activity">
      <h2 className="text-base font-semibold text-fg">{m.project.recentChanges}</h2>
      {error && !data ? (
        <InlineMessage appearance="error" title={describeError(error).message} />
      ) : loading && !data ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : issues.length === 0 ? (
        <EmptyState icon="list" message={m.project.noActivity} />
      ) : (
        <ul className="rounded-md border border-border bg-raised">
          {issues.map((i) => (
            <li key={i.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => open(i.id, { identifier: i.identifier })}
                className="flex h-10 w-full items-center gap-3 px-3 text-left transition-colors duration-100 hover:bg-hover"
              >
                <StatusIcon category={i.status.category} color={i.status.color} label={i.status.name} />
                <span className="identifier w-16 shrink-0">{i.identifier}</span>
                <span className="min-w-0 flex-1 truncate text-base text-fg">{i.title}</span>
                {i.assignee ? <Avatar name={i.assignee.name} src={i.assignee.avatarUrl} size={20} /> : null}
                <span className="w-20 shrink-0 text-right text-sm text-fg-subtle">{formatRelative(i.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
