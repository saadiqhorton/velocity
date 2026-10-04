import { useApolloClient } from '@apollo/client';
import type { ApolloCache, Reference } from '@apollo/client';
import { Icon, IconButton } from '@velocity/ui';
import { useWorkspace } from '@/app/workspace';
import { AddFavoriteDocument, FavoriteFieldsFragmentDoc, RemoveFavoriteDocument } from '@/gql/graphql';
import type { FavoriteFieldsFragment, FavoriteKind } from '@/gql/graphql';
import { readIssueRow } from '@/lib/issueCache';
import { useOptimisticMutation } from '@/lib/mutation';
import { m } from '@/i18n';

export interface FavoriteButtonProps {
  kind: FavoriteKind;
  targetId: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Star toggle that adds/removes a sidebar favorite and keeps the Bootstrap `favorites` list in sync. */
export function FavoriteButton({ kind, targetId, size = 'md', className }: FavoriteButtonProps) {
  const ws = useWorkspace();
  const client = useApolloClient();
  const existing = ws.favorites.find((f) => f.kind === kind && f.targetId === targetId) ?? null;

  const [add] = useOptimisticMutation(AddFavoriteDocument, {
    optimistic: (vars) => {
      const base = { __typename: 'Favorite' as const, id: `optimistic-${vars.kind}-${vars.targetId}`, kind: vars.kind, targetId: vars.targetId, sortOrder: Date.now() };
      const none = { team: null, project: null, view: null, cycle: null, issue: null };
      let fav: FavoriteFieldsFragment;
      if (vars.kind === 'team') {
        const t = ws.teamsById.get(vars.targetId);
        if (!t) throw new Error('team not cached');
        fav = { ...base, ...none, team: { __typename: 'Team', id: t.id, key: t.key, name: t.name } };
      } else if (vars.kind === 'project') {
        const p = ws.projectsById.get(vars.targetId);
        if (!p) throw new Error('project not cached');
        fav = { ...base, ...none, project: { __typename: 'Project', id: p.id, name: p.name, color: p.color, icon: p.icon ?? null } };
      } else if (vars.kind === 'view') {
        const v = ws.views.find((x) => x.id === vars.targetId);
        if (!v) throw new Error('view not cached');
        fav = { ...base, ...none, view: { __typename: 'View', id: v.id, name: v.name, slug: v.slug, icon: v.icon ?? null, color: v.color ?? null } };
      } else if (vars.kind === 'issue') {
        const i = readIssueRow(client.cache, vars.targetId);
        if (!i) throw new Error('issue not cached');
        fav = { ...base, ...none, issue: { __typename: 'Issue', id: i.id, identifier: i.identifier, title: i.title } };
      } else {
        throw new Error('cycle favorites are confirmed by the server');
      }
      return { __typename: 'Mutation' as const, addFavorite: fav };
    },
    rollback: () => m.flags.rollback.favorite,
    update: (cache, result) => {
      const fav = result.data?.addFavorite;
      if (!fav) return;
      appendFavorite(cache, fav);
    },
  });

  const [remove] = useOptimisticMutation(RemoveFavoriteDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, removeFavorite: true }),
    rollback: () => m.flags.rollback.favorite,
    update: (cache, _result, vars) => {
      cache.modify({
        fields: {
          favorites(current: Reference | readonly Reference[] = []) {
            const list = Array.isArray(current) ? (current as readonly Reference[]) : [];
            const ref = cache.identify({ __typename: 'Favorite', id: vars.id });
            return list.filter((r) => r.__ref !== ref);
          },
        },
      });
      cache.evict({ id: cache.identify({ __typename: 'Favorite', id: vars.id }) });
    },
  });

  const toggle = () => {
    if (existing) void remove({ id: existing.id });
    else void add({ kind, targetId });
  };
  const label = existing ? m.common.unfavorite : m.common.favorite;
  return (
    <IconButton
      label={label}
      size={size}
      aria-pressed={Boolean(existing)}
      onClick={toggle}
      className={className}
      data-testid="favorite-button"
      icon={existing ? <Icon name="star-filled" style={{ color: 'var(--ds-status-yellow)' }} /> : <Icon name="favorite" />}
    />
  );
}

function appendFavorite(cache: ApolloCache<unknown>, fav: FavoriteFieldsFragment): void {
  const ref = cache.writeFragment({ data: fav, fragment: FavoriteFieldsFragmentDoc, fragmentName: 'FavoriteFields' });
  if (!ref) return;
  cache.modify({
    fields: {
      favorites(current: Reference | readonly Reference[] = []) {
        const list = Array.isArray(current) ? (current as readonly Reference[]) : [];
        return list.some((r) => r.__ref === ref.__ref) ? list : [...list, ref];
      },
    },
  });
}
