import { Suspense, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { BootstrapDocument, ViewerDocument } from '@/gql/graphql';
import { WorkspaceProvider, useWorkspaceData } from '@/app/workspace';
import { ErrorScreen } from '@/app/RouteError';
import { Realtime } from '@/lib/realtime';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { ShellSkeleton, ContentSkeleton } from './ShellSkeleton';
import { CycleClosingBanner, DeletionBanner, OfflineBanner } from './Banners';
import { DetailPanel, preloadIssueDetail } from './DetailPanel';
import { ThemeSync } from './theme';
import { CodingToolsSync } from './CodingToolsSync';
import { GlobalCommands } from '@/components/commands/GlobalCommands';
import { IssueCommands } from '@/components/commands/IssueCommands';
import { Overlays } from './Overlays';
import { m } from '@/i18n';

/**
 * The application shell (SPEC §4.10): sidebar | content | detail panel. There is no top
 * bar — identity, search, New, settings and the account live in the sidebar.
 */
export function AppShell() {
  const viewer = useQuery(ViewerDocument, { fetchPolicy: 'cache-first' });
  const boot = useQuery(BootstrapDocument, { fetchPolicy: 'cache-and-network' });
  const ws = useWorkspaceData(viewer.data?.viewer, boot.data);

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 400));
    idle(() => preloadIssueDetail());
  }, []);

  if (!ws) {
    if (boot.error && !boot.data) return <ErrorScreen onRetry={() => void boot.refetch()} />;
    return <ShellSkeleton />;
  }

  return (
    <WorkspaceProvider value={ws}>
      <CodingToolsSync viewer={ws.viewer}>
      <ThemeSync />
      <Realtime />
      <GlobalCommands />
      <IssueCommands />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-raised focus:px-3 focus:py-2"
      >
        {m.nav.skipToContent}
      </a>
      <div className="relative flex h-full overflow-hidden bg-surface" data-testid="app-shell">
        <Sidebar className="hidden w-(--ds-layout-sidebar-compact) md:flex xl:w-(--ds-layout-sidebar)" />
        <MobileNav />
        <main id="main-content" data-region="list" tabIndex={-1} className="relative flex min-w-0 flex-1 flex-col outline-none">
          <OfflineBanner />
          <DeletionBanner />
          <CycleClosingBanner />
          <div className="flex min-h-0 flex-1 flex-col">
            <Suspense fallback={<ContentSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
        <DetailPanel />
      </div>
      <Overlays />
      </CodingToolsSync>
    </WorkspaceProvider>
  );
}
