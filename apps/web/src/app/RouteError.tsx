import { useRouteError } from 'react-router-dom';
import { Button, EmptyState } from '@velocity/ui';
import { m } from '@/i18n';

export function ErrorScreen({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex h-full items-center justify-center bg-surface">
      <EmptyState
        icon="warning"
        message={m.shell.loadError}
        action={
          <Button variant="primary" onClick={onRetry ?? (() => window.location.reload())}>
            {m.common.retry}
          </Button>
        }
      />
    </div>
  );
}

export function RouteError() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  return <ErrorScreen />;
}
