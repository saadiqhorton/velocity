import { Link } from 'react-router-dom';
import { EmptyState } from '@velocity/ui';
import { ViewHeader } from '@/components/shell/ViewHeader';
import { m } from '@/i18n';

export function NotFound({ message = m.shell.notFound }: { message?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader title="" create={false} />
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon="warning"
          message={message}
          action={
            <Link to="/my-issues" className="text-base font-medium text-link hover:underline">
              {m.shell.goHome}
            </Link>
          }
        />
      </div>
    </div>
  );
}
