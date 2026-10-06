import { Link } from 'react-router-dom';
import { EmptyState } from '@velocity/ui';
import type { IconName } from '@velocity/ui';
import { useWorkspace } from '@/app/workspace';
import { ViewHeader } from '@/components/shell/ViewHeader';
import { m } from '@/i18n';

export type FeatureKey = 'cycles' | 'estimates' | 'insights' | 'members';

const ICONS: Record<FeatureKey, IconName> = { cycles: 'cycle', estimates: 'chart', insights: 'chart', members: 'users' };

/**
 * A screen whose feature is off in Solo mode (U4): a page-level notice that says so, with a
 * link to Settings › Features for the owner (members are told who can turn it on).
 */
export function FeatureOffNotice({ feature, header = true }: { feature: FeatureKey; header?: boolean }) {
  const { viewer } = useWorkspace();
  const name = m.features.names[feature];
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`feature-off-${feature}`}>
      {header ? <ViewHeader title={name} create={false} /> : null}
      <EmptyState
        icon={ICONS[feature]}
        fill
        message={viewer.isOwner ? m.features.offOwner(name) : m.features.offMember(name)}
        action={
          viewer.isOwner ? (
            <Link
              to="/settings/features"
              className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-base font-medium text-fg-inverse transition-colors duration-100 hover:bg-primary-hover"
              data-testid="feature-settings-link"
            >
              {m.features.openSettings}
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}
