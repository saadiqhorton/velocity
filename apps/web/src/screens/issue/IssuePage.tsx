import { Suspense, lazy } from 'react';
import { useParams } from 'react-router-dom';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';

const IssueDetail = lazy(() => import('@/components/issue-detail/IssueDetail').then((mod) => ({ default: mod.IssueDetail })));

/** Full-page issue view (⌘Enter, and every issue on narrow screens). */
export function IssuePage() {
  const { id } = useParams();
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-region="panel">
      <Suspense fallback={<ContentSkeleton rows={6} />}>
        <IssueDetail key={id} id={id ?? ''} mode="page" />
      </Suspense>
    </div>
  );
}
