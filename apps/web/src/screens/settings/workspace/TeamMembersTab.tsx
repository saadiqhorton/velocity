import { useState } from 'react';
import { useQuery } from '@apollo/client';
import { Avatar, Banner, Button, EmptyState, Icon, IconButton, Select, Skeleton, Table } from '@velocity/ui';
import type { TableColumn } from '@velocity/ui';
import { SetTeamMembershipDocument, TeamMembersDocument } from '@/gql/graphql';
import type { TeamFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useOptimisticMutation } from '@/lib/mutation';
import { describeError } from '@/lib/errors';
import { SectionBody, SettingsSection } from '../common';
import { m } from '@/i18n';

interface Row {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export function TeamMembersTab({ team }: { team: TeamFieldsFragment }) {
  const t = m.settingsWorkspace.teamMembers;
  const { activeUsers } = useWorkspace();
  const { data, loading, error } = useQuery(TeamMembersDocument, { variables: { id: team.id } });
  const [pick, setPick] = useState('');
  const [setMembership, { loading: saving }] = useOptimisticMutation(SetTeamMembershipDocument, {
    optimistic: (vars) => ({ __typename: 'Mutation' as const, setTeamMembership: vars.member }),
    rollback: () => t.flag,
    update: (cache, _res, vars) => {
      cache.modify({
        id: cache.identify({ __typename: 'Team', id: vars.teamId }),
        fields: {
          members(existing: readonly { __ref: string }[] = [], { toReference }) {
            const ref = toReference({ __typename: 'User', id: vars.userId });
            const without = existing.filter((r) => r.__ref !== ref?.__ref);
            return vars.member && ref ? [...without, ref] : without;
          },
        },
      });
    },
    refetchQueries: ['TeamMembers', 'TeamsMemberCounts'],
  });

  const members: Row[] = data?.team?.members ?? [];
  const memberIds = new Set(members.map((x) => x.id));
  const candidates = activeUsers.filter((u) => !memberIds.has(u.id));

  const columns: TableColumn<Row>[] = [
    {
      key: 'member',
      header: t.member,
      render: (u) => (
        <span className="flex items-center gap-2">
          <Avatar name={u.name} src={u.avatarUrl} size={24} />
          <span className="truncate font-medium text-fg">{u.name}</span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{m.common.more}</span>,
      width: 48,
      align: 'right',
      render: (u) => (
        <IconButton
          label={t.remove(u.name)}
          size="sm"
          variant="subtle"
          icon={<Icon name="close" />}
          onClick={() => void setMembership({ teamId: team.id, userId: u.id, member: false })}
        />
      ),
    },
  ];

  return (
    <SettingsSection title={t.section} description={t.description} actions={<span className="text-sm text-fg-subtle">{t.count(members.length)}</span>} testId="team-members-settings">
      {error ? (
        <SectionBody>
          <Banner appearance="error">{describeError(error).message}</Banner>
        </SectionBody>
      ) : loading && !data ? (
        <SectionBody className="flex flex-col gap-2">
          <Skeleton height={32} />
          <Skeleton height={32} />
        </SectionBody>
      ) : (
        <>
          <div className="overflow-hidden rounded-t-md">
            <Table aria-label={t.tableLabel} columns={columns} rows={members} rowKey={(u) => u.id} emptyState={<EmptyState icon="users" message={t.empty} />} />
          </div>
          {candidates.length > 0 ? (
            <SectionBody className="flex items-end gap-2 border-t border-border">
              <div className="w-64">
                <Select
                  label={t.addLabel}
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                  options={[{ value: '', label: t.addPlaceholder }, ...candidates.map((u) => ({ value: u.id, label: u.name }))]}
                />
              </div>
              <Button
                variant="primary"
                loading={saving}
                disabled={pick === ''}
                onClick={() => {
                  void setMembership({ teamId: team.id, userId: pick, member: true }).then(() => setPick(''));
                }}
              >
                {t.add}
              </Button>
            </SectionBody>
          ) : null}
        </>
      )}
    </SettingsSection>
  );
}
