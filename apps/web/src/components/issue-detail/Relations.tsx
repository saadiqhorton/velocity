import { Button, Icon, IconButton, StatusIcon } from '@velocity/ui';
import { RemoveRelationDocument } from '@/gql/graphql';
import type { RelationType } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { useOpenIssue } from '@/lib/navigation';
import { useUi } from '@/stores/ui';
import type { DetailIssue } from './IssueDetail';
import { m } from '@/i18n';

const ORDER: RelationType[] = ['blocked_by', 'blocks', 'related', 'duplicate', 'duplicated_by'];

/** Relations grouped by type, both directions (SPEC §3.5.3). */
export function Relations({ issue }: { issue: DetailIssue }) {
  const openIssue = useOpenIssue();
  const openPicker = useUi((s) => s.openPicker);
  const [remove] = useOptimisticMutation(RemoveRelationDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, removeRelation: true }),
    rollback: () => m.flags.rollback.relation,
    update: (cache, _res, vars) => {
      cache.modify({
        id: cache.identify({ __typename: 'Issue' as const, id: issue.id }),
        fields: {
          relations: (existing: readonly { __ref: string }[] = [], { readField }) => existing.filter((r) => readField('id', r) !== vars.id),
        },
      });
    },
  });
  const groups = ORDER.map((type) => ({ type, items: issue.relations.filter((r) => r.type === type) })).filter((g) => g.items.length > 0);
  return (
    <div className="flex flex-col gap-2" data-testid="relations">
      {groups.map((g) => (
        <div key={g.type} className="flex flex-col">
          <div className="px-1 text-sm text-fg-subtlest">{m.relationType[g.type]}</div>
          {g.items.map((r) => (
            <div key={r.id} className="group/rel flex h-8 items-center gap-2 rounded-sm px-1 hover:bg-hover">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-base" onClick={() => openIssue(r.issue.id)}>
                {g.type === 'blocked_by' ? <Icon name="blocked" className="text-danger-fg" /> : null}
                <StatusIcon category={r.issue.status.category} color={r.issue.status.color} label={r.issue.status.name} />
                <span className="identifier shrink-0">{r.issue.identifier}</span>
                <span className="min-w-0 truncate text-fg">{r.issue.title}</span>
              </button>
              <IconButton
                label={m.common.remove}
                size="sm"
                icon={<Icon name="close" />}
                className="opacity-0 group-hover/rel:opacity-100 focus:opacity-100"
                onClick={() => void remove({ id: r.id })}
              />
            </div>
          ))}
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="subtle"
          iconBefore={<Icon name="relation" />}
          onClick={(e) => openPicker({ kind: 'relation', issueIds: [issue.id], anchor: e.currentTarget })}
        >
          {m.issue.addRelation}
        </Button>
      </div>
    </div>
  );
}
