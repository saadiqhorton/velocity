import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Button, DropdownMenu, EmptyState, Icon, IconButton, Lozenge, MenuItem, Table } from '@velocity/ui';
import type { TableColumn } from '@velocity/ui';
import { ReorderTeamDocument, TeamsAdminDocument, TeamsMemberCountsDocument } from '@/gql/graphql';
import type { TeamFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useOptimisticMutation } from '@/lib/mutation';
import { TeamIcon } from '@/components/common/EntityIcons';
import { SettingsPage } from '../common';
import { orderBetween } from './shared';
import { m } from '@/i18n';

export function TeamsSettings() {
  const t = m.settingsWorkspace.teams;
  const navigate = useNavigate();
  const { teams } = useWorkspace();
  const { data: adminData } = useQuery(TeamsAdminDocument);
  const archived = (adminData?.teams ?? []).filter((x) => x.archivedAt).sort((a, b) => a.name.localeCompare(b.name));
  const [showArchived, setShowArchived] = useState(false);
  const { data } = useQuery(TeamsMemberCountsDocument);
  const memberCounts = new Map((data?.teams ?? []).map((x) => [x.id, x.members.length]));

  const [reorder] = useOptimisticMutation(ReorderTeamDocument, {
    optimistic: (vars) => {
      const prev = teams.find((x) => x.id === vars.beforeId);
      const next = teams.find((x) => x.id === vars.afterId);
      return {
        __typename: 'Mutation' as const,
        reorderTeam: { __typename: 'Team' as const, id: vars.id, sortOrder: orderBetween(prev?.sortOrder ?? null, next?.sortOrder ?? null) },
      };
    },
    rollback: () => t.flag.reorder,
  });

  const move = (id: string, delta: -1 | 1) => {
    const idx = teams.findIndex((x) => x.id === id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= teams.length) return;
    // Moving up places the team between the two above the target; down between target and the one below.
    const withoutSelf = teams.filter((x) => x.id !== id);
    const before = withoutSelf[target - 1] ?? null;
    const after = withoutSelf[target] ?? null;
    void reorder({ id, beforeId: before?.id ?? null, afterId: after?.id ?? null });
  };

  const columns = (editable: boolean): TableColumn<TeamFieldsFragment>[] => {
    const cols: TableColumn<TeamFieldsFragment>[] = [
      {
        key: 'team',
        header: t.colTeam,
        render: (x) => (
          <span className="flex min-w-0 items-center gap-2">
            <TeamIcon team={x} size={20} />
            <span className="truncate font-medium text-fg">{x.name}</span>
          </span>
        ),
      },
      { key: 'key', header: t.colKey, width: 96, render: (x) => <span className="identifier">{x.key}</span> },
      {
        key: 'members',
        header: t.colMembers,
        width: 96,
        render: (x) => <span className="text-fg-subtle">{memberCounts.get(x.id) ?? '–'}</span>,
      },
      {
        key: 'cycles',
        header: t.colCycles,
        width: 96,
        render: (x) => <Lozenge appearance={x.cycleEnabled ? 'success' : 'default'}>{x.cycleEnabled ? t.cyclesOn : t.cyclesOff}</Lozenge>,
      },
      { key: 'issues', header: t.colIssues, width: 112, align: 'right', render: (x) => <span className="text-fg-subtle">{x.openIssueCount}</span> },
    ];
    if (editable) {
      cols.push({
        key: 'actions',
        header: <span className="sr-only">{m.common.more}</span>,
        width: 48,
        align: 'right',
        render: (x) => {
          const idx = teams.findIndex((y) => y.id === x.id);
          return (
            <DropdownMenu
              aria-label={t.actionsFor(x.name)}
              placement="bottom-end"
              trigger={<IconButton label={t.actionsFor(x.name)} size="sm" variant="subtle" icon={<Icon name="more" />} onClick={(e) => e.stopPropagation()} />}
            >
              <MenuItem icon={<Icon name="settings" />} onSelect={() => navigate(`/settings/teams/${x.key}`)}>
                {t.openSettings}
              </MenuItem>
              <MenuItem icon={<Icon name="arrow-up" />} disabled={idx <= 0} onSelect={() => move(x.id, -1)}>
                {t.moveUp}
              </MenuItem>
              <MenuItem icon={<Icon name="arrow-down" />} disabled={idx < 0 || idx >= teams.length - 1} onSelect={() => move(x.id, 1)}>
                {t.moveDown}
              </MenuItem>
            </DropdownMenu>
          );
        },
      });
    }
    return cols;
  };

  const create = (
    <Button variant="primary" iconBefore={<Icon name="add" />} onClick={() => navigate('/settings/teams/new')}>
      {t.create}
    </Button>
  );

  return (
    <SettingsPage title={m.settings.sections.teams} description={t.description} wide actions={create} testId="settings-teams">
      <div className="overflow-hidden rounded-md border border-border" data-testid="teams-table">
        <Table
          aria-label={t.tableLabel}
          columns={columns(true)}
          rows={teams}
          rowKey={(x) => x.id}
          sort={null}
          onRowClick={(x) => navigate(`/settings/teams/${x.key}`)}
          emptyState={<EmptyState icon="team" message={t.empty} action={create} />}
        />
      </div>
      {archived.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label={t.archivedTitle(archived.length)}>
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="flex h-8 w-fit items-center gap-1 rounded-sm text-base font-semibold text-fg hover:text-fg-subtle"
          >
            <Icon name={showArchived ? 'chevron-down' : 'chevron-right'} />
            {t.archivedTitle(archived.length)}
          </button>
          {showArchived ? (
            <div className="overflow-hidden rounded-md border border-border" data-testid="archived-teams-table">
              <Table
                aria-label={t.archivedTitle(archived.length)}
                columns={columns(false)}
                rows={archived}
                rowKey={(x) => x.id}
                sort={null}
                onRowClick={(x) => navigate(`/settings/teams/${x.key}`)}
              />
            </div>
          ) : null}
        </section>
      ) : null}
    </SettingsPage>
  );
}
