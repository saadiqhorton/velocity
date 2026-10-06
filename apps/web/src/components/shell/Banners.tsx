import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Banner, Button } from '@velocity/ui';
import { CancelWorkspaceDeletionDocument, CyclesClosingSoonDocument } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useConnection } from '@/stores/connection';
import { useOptimisticMutation } from '@/lib/mutation';
import { formatDate } from '@/lib/format';
import { useFeatures } from '@/lib/features';
import { m } from '@/i18n';

export const OFFLINE_BANNER_DELAY_MS = 5000;

/** Offline inline message after 5s down (SPEC §5.5). */
export function OfflineBanner() {
  const downSince = useConnection((s) => s.downSince);
  // The outage (by start time) that has lasted long enough to show the banner.
  const [shownFor, setShownFor] = useState<number | null>(null);
  useEffect(() => {
    if (downSince === null) return;
    const wait = Math.max(0, OFFLINE_BANNER_DELAY_MS - (Date.now() - downSince));
    const t = setTimeout(() => setShownFor(downSince), wait);
    return () => clearTimeout(t);
  }, [downSince]);
  if (downSince === null || shownFor !== downSince) return null;
  return (
    <div className="px-4 pt-2" data-testid="offline-banner">
      <Banner appearance="warning">{m.shell.offline}</Banner>
    </div>
  );
}

const DISMISS_KEY = 'vel.dismissedCycleBanners';

function readDismissed(): string[] {
  try {
    return JSON.parse(window.sessionStorage.getItem(DISMISS_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Workspace-level banner for cycles that close within a day (SPEC §3.11). */
export function CycleClosingBanner() {
  const features = useFeatures();
  const { data } = useQuery(CyclesClosingSoonDocument, { fetchPolicy: 'cache-and-network', skip: !features.cycles });
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const cycles = (data?.cyclesClosingSoon ?? []).filter((c) => !dismissed.includes(c.id));
  if (cycles.length === 0) return null;
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
  };
  return (
    <div className="flex flex-col gap-2 px-4 pt-2">
      {cycles.map((c) => (
        <Banner
          key={c.id}
          appearance="info"
          onDismiss={() => dismiss(c.id)}
          action={
            <Link to={`/team/${c.team.key}/cycles/${c.id}`} className="shrink-0 self-center text-sm font-medium text-link hover:underline">
              {m.shell.viewCycle}
            </Link>
          }
        >
          {m.shell.cycleClosing(c.name, c.team.name)}
        </Banner>
      ))}
    </div>
  );
}

/** Owner-scheduled deletion notice with a cancel action (SPEC §3.3). */
export function DeletionBanner() {
  const { workspace, viewer } = useWorkspace();
  const [cancel, { loading }] = useOptimisticMutation(CancelWorkspaceDeletionDocument, {
    optimistic: () => ({
      __typename: 'Mutation' as const,
      cancelWorkspaceDeletion: {
        __typename: 'Workspace' as const,
        name: workspace?.name ?? '',
        deletionRequestedAt: null,
        deletionScheduledFor: null,
      },
    }),
    rollback: () => m.flags.rollback.settings,
  });
  if (!workspace?.deletionScheduledFor) return null;
  return (
    <div className="px-4 pt-2">
      <Banner
        appearance="error"
        action={
          viewer.isOwner ? (
            <Button variant="default" size="sm" loading={loading} onClick={() => void cancel({})}>
              {m.shell.cancelDeletion}
            </Button>
          ) : undefined
        }
      >
        {m.shell.deletionScheduled(formatDate(workspace.deletionScheduledFor))}
      </Banner>
    </div>
  );
}
