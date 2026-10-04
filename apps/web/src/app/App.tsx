import { useEffect, useMemo } from 'react';
import { ApolloProvider } from '@apollo/client';
import { RouterProvider } from 'react-router-dom';
import { FlagProvider } from '@velocity/ui';
import { createApollo } from '@/lib/apollo';
import { useConnection } from '@/stores/connection';
import { watchSystemTheme } from '@/stores/theme';
import { KeyboardRoot } from '@/keyboard/react';
import { createAppRouter } from './router';

export function App() {
  const { client, router } = useMemo(() => {
    let routerRef: ReturnType<typeof createAppRouter> | null = null;
    const apollo = createApollo({
      onUnauthenticated: () => {
        const path = window.location.pathname;
        if (path.startsWith('/login') || path.startsWith('/setup') || path.startsWith('/invite')) return;
        void apollo.client.clearStore().then(() => {
          void routerRef?.navigate(`/login?next=${encodeURIComponent(path + window.location.search)}&expired=1`);
        });
      },
    });
    routerRef = createAppRouter();
    return { client: apollo.client, router: routerRef };
  }, []);

  useEffect(() => watchSystemTheme(), []);
  useEffect(() => {
    const set = useConnection.getState().setOnline;
    const on = () => set(true);
    const off = () => set(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return (
    <ApolloProvider client={client}>
      <FlagProvider>
        <KeyboardRoot />
        <RouterProvider router={router} />
      </FlagProvider>
    </ApolloProvider>
  );
}
