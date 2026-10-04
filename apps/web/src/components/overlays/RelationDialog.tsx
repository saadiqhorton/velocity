import { useEffect, useId, useState } from 'react';
import { useQuery } from '@apollo/client';
import { Modal, OptionList, Select, StatusIcon, useOptionListNavigation } from '@velocity/ui';
import type { PopupOption } from '@velocity/ui';
import { AddRelationDocument, IssueSearchDocument } from '@/gql/graphql';
import type { RelationInputType } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';

const TYPES: RelationInputType[] = ['blocks', 'blocked_by', 'related', 'duplicate'];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** `R` → add relation: pick a type, then search the target issue (SPEC §3.5.3). */
export function RelationDialog({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  const listId = useId();
  const [type, setType] = useState<RelationInputType>('related');
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 150);
  const { data } = useQuery(IssueSearchDocument, { variables: { query: q, limit: 10 }, skip: q.length === 0 });
  const [add] = useOptimisticMutation(AddRelationDocument, {
    optimistic: { serverConfirmed: 'The relation id and inverse direction come from the server.' },
    rollback: () => m.flags.rollback.relation,
    refetchQueries: ['IssueDetail'],
  });
  const options: PopupOption[] = (data?.search ?? [])
    .flatMap((r) => (r.issue && r.issue.id !== issueId ? [r.issue] : []))
    .map((i) => ({
      value: i.id,
      label: `${i.identifier} ${i.title}`,
      icon: <StatusIcon category={i.status.category} color={i.status.color} label="" />,
    }));
  const choose = (target: string) => {
    onClose();
    void add({ issueId, targetIssueId: target, type });
  };
  const nav = useOptionListNavigation({ listId, options, onSelect: choose });
  return (
    <Modal open onClose={onClose} title={m.issue.addRelation} size="md">
      <div className="flex flex-col gap-3 pb-3">
        <Select
          label={m.issue.relations}
          value={type}
          onChange={(e) => setType(e.target.value as RelationInputType)}
          options={TYPES.map((t) => ({ value: t, label: m.relationType[t] }))}
        />
        <input
          data-autofocus
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={nav.activeDescendant}
          aria-label={m.common.search}
          placeholder={m.palette.placeholderIssues}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            nav.handleKeyDown(e);
          }}
          className="h-8 w-full rounded-sm border border-border-input bg-input px-2 text-base text-fg placeholder:text-fg-subtlest focus:border-primary"
        />
        <OptionList
          id={listId}
          aria-label={m.palette.issues}
          options={options}
          selectedValues={[]}
          activeValue={nav.activeValue}
          onActiveChange={nav.setActiveValue}
          onSelect={(o) => choose(o.value)}
          emptyMessage={q ? m.palette.noResults : m.palette.placeholderIssues}
          className="rounded-sm border border-border"
        />
      </div>
    </Modal>
  );
}
