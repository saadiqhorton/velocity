import { Suspense } from 'react';
import { ChunkBoundary, retryableLazy } from '@/components/common/ChunkBoundary';
import { useClosePanel, usePanelIssueId } from '@/lib/navigation';
import { m } from '@/i18n';

const loadDetail = () => import('@/components/issue-detail/IssueDetail');
const issueDetail = retryableLazy(async () => ({ default: (await loadDetail()).IssueDetail }));
const IssueDetail = issueDetail.Component;

export function preloadIssueDetail(): void {
  // A prefetch only: if it fails (e.g. offline), the lazy component loads again when it renders.
  loadDetail().catch(() => undefined);
}

function PanelSkeleton() {
  return <div className="h-full" aria-busy="true" />;
}

/**
 * Right detail panel (SPEC §4.10.2): 400px (360px below 1280), `surface` with a 1px left
 * border. Overlays the content between 768 and 1024px; below 768 issues open as a page.
 */
export function DetailPanel() {
  const issueId = usePanelIssueId();
  const close = useClosePanel();
  if (!issueId) return null;
  return (
    <aside
      data-region="panel"
      data-testid="detail-panel"
      aria-label={m.issue.title}
      className="absolute inset-y-0 right-0 z-10 flex h-full w-full shrink-0 flex-col border-l border-border bg-surface md:w-(--ds-layout-panel-compact) lg:static xl:w-(--ds-layout-panel)"
    >
      <ChunkBoundary onRetry={issueDetail.reset}>
        <Suspense fallback={<PanelSkeleton />}>
          <IssueDetail key={issueId} id={issueId} mode="panel" onClose={() => close()} />
        </Suspense>
      </ChunkBoundary>
    </aside>
  );
}
