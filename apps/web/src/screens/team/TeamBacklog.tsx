import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button, EmptyState, Icon } from '@velocity/ui';
import { useTeamByKey } from '@/app/workspace';
import { ListScreen } from '@/components/issues/ListScreen';
import { TeamIcon } from '@/components/common/EntityIcons';
import { DEFAULT_DISPLAY } from '@/lib/viewState';
import type { ViewState } from '@/lib/viewState';
import { useUi } from '@/stores/ui';
import { NotFound } from '@/screens/workspace/NotFound';
import { m } from '@/i18n';

/** Team backlog (SPEC §4.11.2): flat manual order, drag + ⌥↑/↓, group-by-priority toggle. */
export function TeamBacklog() {
  const { key } = useParams();
  const team = useTeamByKey(key);
  const [params, setParams] = useSearchParams();
  const openCreate = useUi((s) => s.openCreate);
  const defaults = useMemo<ViewState>(
    () => ({ filter: '', display: { ...DEFAULT_DISPLAY, grouping: 'none', ordering: 'manual', columns: ['priority', 'identifier', 'labels', 'project', 'assignee'] } }),
    [],
  );
  if (!team) return <NotFound message={m.team.notFound} />;
  const byPriority = params.get('group') === 'priority';
  const backlogStatus = [...team.statuses].sort((a, b) => a.order - b.order).find((s) => s.category === 'backlog');
  return (
    <ListScreen
      listId={`team-backlog-${team.id}`}
      title={`${team.name} · ${m.team.backlogTitle}`}
      icon={<TeamIcon team={team} />}
      scope={{ teamId: team.id }}
      defaults={defaults}
      extraFilters={['statusCategory:backlog']}
      context={{ teamId: team.id, statusId: backlogStatus?.id }}
      reorderable
      hiddenFilterFields={['team', 'status', 'statusCategory']}
      headerExtra={
        <Button
          size="sm"
          variant={byPriority ? 'default' : 'subtle'}
          aria-pressed={byPriority}
          iconBefore={<Icon name="priority-high" />}
          onClick={() =>
            setParams(
              (prev) => {
                const p = new URLSearchParams(prev);
                if (byPriority) p.delete('group');
                else p.set('group', 'priority');
                return p;
              },
              { replace: true },
            )
          }
        >
          {m.team.groupByPriority}
        </Button>
      }
      empty={
        <EmptyState
          icon="backlog"
          message={m.list.emptyBacklog}
          action={
            <Button variant="primary" onClick={() => openCreate({ teamId: team.id, statusId: backlogStatus?.id })}>
              {m.issue.createIssue}
            </Button>
          }
        />
      }
    />
  );
}
