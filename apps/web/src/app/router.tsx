import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import type { ComponentType } from 'react';
import type { LazyRouteFunction, RouteObject } from 'react-router-dom';
import { AuthGate } from './AuthGate';
import { RouteError } from './RouteError';

/** Route-level code splitting (SPEC §4.16): every screen is its own chunk. */
function screen<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M): LazyRouteFunction<RouteObject> {
  return async () => {
    const mod = await load();
    return { Component: mod[name] as ComponentType };
  };
}

function TeamIndexRedirect() {
  const { key } = useParams();
  return <Navigate to={`/team/${key ?? ''}/active`} replace />;
}

const authed: RouteObject[] = [
  { index: true, lazy: screen(() => import('@/screens/workspace/Home'), 'Home') },
  { path: 'team/:key', element: <TeamIndexRedirect /> },
  { path: 'team/:key/active', lazy: screen(() => import('@/screens/team/TeamActive'), 'TeamActive') },
  { path: 'team/:key/backlog', lazy: screen(() => import('@/screens/team/TeamBacklog'), 'TeamBacklog') },
  { path: 'team/:key/all', lazy: screen(() => import('@/screens/team/TeamAll'), 'TeamAll') },
  { path: 'team/:key/cycles', lazy: screen(() => import('@/screens/team/TeamCycles'), 'TeamCycles') },
  { path: 'team/:key/cycles/:cycleId', lazy: screen(() => import('@/screens/team/TeamCycles'), 'TeamCycles') },
  { path: 'team/:key/projects', lazy: screen(() => import('@/screens/project/ProjectsList'), 'ProjectsList') },
  { path: 'team/:key/views', lazy: screen(() => import('@/screens/views/ViewsList'), 'ViewsList') },
  { path: 'issues', lazy: screen(() => import('@/screens/workspace/AllIssues'), 'AllIssues') },
  { path: 'issue/:id', lazy: screen(() => import('@/screens/issue/IssuePage'), 'IssuePage') },
  { path: 'projects', lazy: screen(() => import('@/screens/project/ProjectsList'), 'ProjectsList') },
  { path: 'project/:id', lazy: screen(() => import('@/screens/project/ProjectDetail'), 'ProjectDetail') },
  { path: 'project/:id/:tab', lazy: screen(() => import('@/screens/project/ProjectDetail'), 'ProjectDetail') },
  { path: 'views', lazy: screen(() => import('@/screens/views/ViewsList'), 'ViewsList') },
  { path: 'view/new', lazy: screen(() => import('@/screens/views/ViewPage'), 'ViewPage') },
  { path: 'view/:slug', lazy: screen(() => import('@/screens/views/ViewPage'), 'ViewPage') },
  { path: 'inbox', lazy: screen(() => import('@/screens/inbox/Inbox'), 'Inbox') },
  { path: 'my-issues', lazy: screen(() => import('@/screens/my-issues/MyIssues'), 'MyIssues') },
  { path: 'my-issues/:preset', lazy: screen(() => import('@/screens/my-issues/MyIssues'), 'MyIssues') },
  { path: 'insights', lazy: screen(() => import('@/screens/insights/Insights'), 'Insights') },
  { path: 'search', lazy: screen(() => import('@/screens/search/SearchScreen'), 'SearchScreen') },
  { path: 'settings/*', lazy: screen(() => import('@/screens/settings/Settings'), 'Settings') },
  { path: '*', lazy: screen(() => import('@/screens/workspace/NotFound'), 'NotFound') },
];

export function createAppRouter() {
  const routes: RouteObject[] = [
    {
      path: '/',
      element: <AuthGate />,
      errorElement: <RouteError />,
      children: [
        { path: 'login', lazy: screen(() => import('@/screens/auth/Login'), 'Login') },
        { path: 'setup', lazy: screen(() => import('@/screens/auth/Setup'), 'Setup') },
        { path: 'invite/:token', lazy: screen(() => import('@/screens/auth/Invite'), 'Invite') },
        // Component gallery for visual checks: its own chunk, gated at runtime (see GalleryScreen).
        { path: '__gallery', lazy: screen(() => import('@/screens/dev/GalleryScreen'), 'GalleryScreen') },
        {
          lazy: screen(() => import('@/components/shell/AppShell'), 'AppShell'),
          children: authed,
        },
      ],
    },
  ];
  return createBrowserRouter(routes, {
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  });
}
