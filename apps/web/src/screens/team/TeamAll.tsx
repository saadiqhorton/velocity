import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTeamByKey } from '@/app/workspace';
import { ListScreen } from '@/components/issues/ListScreen';
import { TeamIcon } from '@/components/common/EntityIcons';
import { DEFAULT_DISPLAY } from '@/lib/viewState';
import type { ViewState } from '@/lib/viewState';
import { NotFound } from '@/screens/workspace/NotFound';
import { m } from '@/i18n';

/** Team preset "All" (SPEC §3.10). */
export function TeamAll() {
  const { key } = useParams();
  const team = useTeamByKey(key);
  const defaults = useMemo<ViewState>(() => ({ filter: '', display: DEFAULT_DISPLAY }), []);
  if (!team) return <NotFound message={m.team.notFound} />;
  return (
    <ListScreen
      listId={`team-all-${team.id}`}
      title={`${team.name} · ${m.team.allTitle}`}
      icon={<TeamIcon team={team} />}
      scope={{ teamId: team.id }}
      defaults={defaults}
      context={{ teamId: team.id }}
      hiddenFilterFields={['team']}
    />
  );
}
