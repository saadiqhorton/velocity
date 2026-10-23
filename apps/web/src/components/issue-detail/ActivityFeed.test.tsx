import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, gql } from '@apollo/client';
import { ActivityItem, collapseBursts, withCreation } from './ActivityFeed';
import type { ActivityEntry } from './ActivityFeed';

vi.mock('@/app/workspace', () => ({
  useWorkspace: () => ({
    statusesById: new Map([['st-done', { id: 'st-done', name: 'Done', category: 'done', color: 'green', order: 3, description: null, teamId: 'team-1' }]]),
    usersById: new Map(),
    labelsById: new Map(),
    projectsById: new Map(),
  }),
}));

const IssueIdentifier = gql`
  fragment IssueIdentifier on Issue {
    id
    identifier
  }
`;

/** A cache that knows the identifiers of the issues a relation can point at. */
function clientWithIssues(identifiers: Record<string, string>) {
  const cache = new InMemoryCache();
  for (const [id, identifier] of Object.entries(identifiers)) {
    cache.writeFragment({ id: cache.identify({ __typename: 'Issue', id }), fragment: IssueIdentifier, data: { __typename: 'Issue', id, identifier } });
  }
  return new ApolloClient({ cache, link: ApolloLink.empty() });
}

const owner = { __typename: 'User' as const, id: 'user-1', name: 'Demo Owner', avatarUrl: null };

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    __typename: 'IssueActivity',
    id: 'act-1',
    type: 'title',
    actorKind: 'user',
    createdAt: '2026-10-01T09:00:00.000Z',
    fromValue: null,
    toValue: null,
    actor: owner,
    ...over,
  };
}

function renderItem(e: ActivityEntry, identifiers: Record<string, string> = { 'issue-2': 'ENG-12', 'issue-7': 'ENG-7' }) {
  return render(
    <ApolloProvider client={clientWithIssues(identifiers)}>
      <ol>
        <ActivityItem entry={e} />
      </ol>
    </ApolloProvider>,
  );
}

describe('relation activity', () => {
  it('names the target of a relation that was added from this issue', () => {
    renderItem(entry({ type: 'relation_added', toValue: { type: 'blocks', direction: 'out', issueId: 'issue-2' } }));
    expect(screen.getByText(/added a blocks relation to ENG-12/)).toBeTruthy();
  });

  it('reads an inbound blocks row as blocked by, from the target side', () => {
    renderItem(entry({ type: 'relation_added', toValue: { type: 'blocks', direction: 'in', issueId: 'issue-2' } }));
    expect(screen.getByText(/added a blocked by relation to ENG-12/)).toBeTruthy();
  });

  it('names the target of a removed relation from the stored payload', () => {
    renderItem(entry({ type: 'relation_removed', fromValue: { type: 'related', direction: 'out', issueId: 'issue-7' } }));
    expect(screen.getByText(/removed a related relation to ENG-7/)).toBeTruthy();
  });

  it('falls back to another issue when the target is not in the cache', () => {
    renderItem(entry({ type: 'relation_added', toValue: { type: 'related', direction: 'out', issueId: 'gone' } }), {});
    expect(screen.getByText(/added a related relation to another issue/)).toBeTruthy();
  });

  it('never prints the raw event type', () => {
    renderItem(entry({ type: 'relation_added', toValue: { type: 'blocks', direction: 'out', issueId: 'issue-2' } }));
    expect(screen.queryByText(/relation added/)).toBeNull();
  });
});

describe('event glyphs', () => {
  it('draws a status icon for a status change and a dot for an unknown event', () => {
    const { container, unmount } = renderItem(entry({ type: 'status', toValue: 'st-done' }));
    expect(container.querySelector('svg')).not.toBeNull();
    unmount();
    const other = renderItem(entry({ type: 'description' }));
    expect(other.container.querySelector('svg')).toBeNull();
    expect(other.container.querySelector('.rounded-full')).not.toBeNull();
  });
});

describe('issue creation line', () => {
  const created = { actor: owner, at: '2026-09-30T09:00:00.000Z' };

  it('adds a created entry first when the log has none', () => {
    const [first, ...rest] = withCreation([entry({ id: 'act-2', type: 'title' })], 'issue-1', created);
    expect(first).toMatchObject({ type: 'created', createdAt: created.at, actor: owner });
    expect(rest.map((e) => e.id)).toEqual(['act-2']);
  });

  it('keeps the log as it is when it already records the creation', () => {
    const log = [entry({ id: 'act-1', type: 'created', createdAt: created.at })];
    expect(withCreation(log, 'issue-1', created)).toEqual(log);
  });

  it('adds nothing without a creator to attribute it to', () => {
    expect(withCreation([], 'issue-1', null)).toEqual([]);
  });

  it('renders as a sentence with the creator and no target', () => {
    const [synth] = withCreation([], 'issue-1', created);
    renderItem(synth!, {});
    expect(screen.getByText(/created the issue/)).toBeTruthy();
    expect(screen.getByText('Demo Owner')).toBeTruthy();
  });
});

describe('edit bursts', () => {
  const at = (minutes: number) => new Date(Date.parse('2026-10-01T09:00:00.000Z') + minutes * 60_000).toISOString();
  const sam = { ...owner, id: 'user-2', name: 'Sam' };

  it('folds quick repeated description edits into one row at the latest time', () => {
    const log = [entry({ id: 'a', type: 'description', createdAt: at(0) }), entry({ id: 'b', type: 'description', createdAt: at(2) })];
    expect(collapseBursts(log)).toEqual([log[1]]);
  });

  it('renders a single "updated the description" row for the burst', () => {
    const log = [entry({ id: 'a', type: 'description', createdAt: at(0) }), entry({ id: 'b', type: 'description', createdAt: at(2) })];
    render(
      <ApolloProvider client={clientWithIssues({})}>
        <ol>
          {collapseBursts(log).map((e) => (
            <ActivityItem key={e.id} entry={e} />
          ))}
        </ol>
      </ApolloProvider>,
    );
    expect(screen.getAllByText(/updated the description/)).toHaveLength(1);
  });

  it('keeps the final status of a status burst', () => {
    const log = [entry({ id: 'a', type: 'status', createdAt: at(0), toValue: 'st-done' }), entry({ id: 'b', type: 'status', createdAt: at(4), toValue: 'st-done' })];
    expect(collapseBursts(log)).toEqual([log[1]]);
  });

  it('folds a chain of edits that are each within 10 minutes of the next', () => {
    const log = [entry({ id: 'a', type: 'title', createdAt: at(0) }), entry({ id: 'b', type: 'title', createdAt: at(6) }), entry({ id: 'c', type: 'title', createdAt: at(12) })];
    expect(collapseBursts(log).map((e) => e.id)).toEqual(['c']);
  });

  it('folds edits exactly 10 minutes apart and keeps edits 11 minutes apart', () => {
    expect(collapseBursts([entry({ id: 'a', type: 'description', createdAt: at(0) }), entry({ id: 'b', type: 'description', createdAt: at(10) })]).map((e) => e.id)).toEqual(['b']);
    expect(collapseBursts([entry({ id: 'a', type: 'description', createdAt: at(0) }), entry({ id: 'b', type: 'description', createdAt: at(11) })]).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('keeps edits by different actors, and different types, apart', () => {
    const log = [
      entry({ id: 'a', type: 'description', createdAt: at(0) }),
      entry({ id: 'b', type: 'description', createdAt: at(1), actor: sam }),
      entry({ id: 'c', type: 'status', createdAt: at(2), actor: sam, toValue: 'st-done' }),
    ];
    expect(collapseBursts(log).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('never folds relation events, which name a different issue each time', () => {
    const log = [
      entry({ id: 'a', type: 'relation_added', createdAt: at(0), toValue: { type: 'blocks', direction: 'out', issueId: 'issue-2' } }),
      entry({ id: 'b', type: 'relation_added', createdAt: at(1), toValue: { type: 'blocks', direction: 'out', issueId: 'issue-7' } }),
    ];
    expect(collapseBursts(log).map((e) => e.id)).toEqual(['a', 'b']);
  });
});
