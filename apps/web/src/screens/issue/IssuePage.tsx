import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { ChunkBoundary, retryableLazy } from '@/components/common/ChunkBoundary';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';
import { m } from '@/i18n';

// Like the detail panel: a failed chunk shows an inline retry, not the full route error (QA G1).
const issueDetail = retryableLazy(async () => ({ default: (await import('@/components/issue-detail/IssueDetail')).IssueDetail }));
const IssueDetail = issueDetail.Component;

/** Full-page issue view (⌘Enter, and every issue on narrow screens). */
export function IssuePage() {
  const { id } = useParams();
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-region="panel">
      <ChunkBoundary onRetry={issueDetail.reset} message={m.shell.panelLoadError} frame={(message) => <div className="p-4">{message}</div>}>
        <Suspense fallback={<ContentSkeleton rows={6} />}>
          <IssueDetail key={id} id={id ?? ''} mode="page" />
        </Suspense>
      </ChunkBoundary>
    </div>
  );
}
