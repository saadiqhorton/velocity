import { useQuery } from '@apollo/client';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { SetupStatusDocument, ViewerDocument } from '@/gql/graphql';
import { ShellSkeleton } from '@/components/shell/ShellSkeleton';
import { ErrorScreen } from './RouteError';

const PUBLIC = ['/login', '/invite/'];

/**
 * Routes by `setupStatus` and `viewer` (SPEC §3.2, §3.3): first run → /setup, signed out →
 * /login?next=…, signed in → the app. The gallery is reachable in every state.
 */
export function AuthGate() {
  const location = useLocation();
  const setup = useQuery(SetupStatusDocument, { fetchPolicy: 'cache-first' });
  const viewer = useQuery(ViewerDocument, { fetchPolicy: 'cache-first' });
  const path = location.pathname;

  if (path.startsWith('/__gallery')) return <Outlet />;
  if (setup.error && !setup.data) return <ErrorScreen onRetry={() => void setup.refetch()} />;
  if (!setup.data || (viewer.loading && !viewer.data)) return <ShellSkeleton />;

  const needsSetup = setup.data.setupStatus.needsSetup;
  const signedIn = Boolean(viewer.data?.viewer);
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p));

  if (needsSetup) {
    return path === '/setup' ? <Outlet /> : <Navigate to="/setup" replace />;
  }
  // The wizard continues after the owner account exists (team, GitHub, done steps).
  if (path === '/setup') {
    if (signedIn) return <Outlet />;
    return <Navigate to="/login" replace />;
  }
  if (!signedIn) {
    if (isPublic) return <Outlet />;
    const next = `${path}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (isPublic) {
    const params = new URLSearchParams(location.search);
    const next = params.get('next');
    return <Navigate to={next && next.startsWith('/') && !next.startsWith('//') ? next : '/'} replace />;
  }
  return <Outlet />;
}
