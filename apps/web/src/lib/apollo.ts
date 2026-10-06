import { ApolloClient, ApolloLink, HttpLink, InMemoryCache, Observable, split } from '@apollo/client';
import type { FieldPolicy, Reference } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { onError } from '@apollo/client/link/error';
import { createPersistedQueryLink } from '@apollo/client/link/persisted-queries';
import { getMainDefinition } from '@apollo/client/utilities';
import { print } from 'graphql';
import { createClient } from 'graphql-ws';
import type { Client as WsClient } from 'graphql-ws';
import { readCsrfToken } from './csrf';
import { useConnection } from '@/stores/connection';
import { runInBackground } from './errors';

const ISSUE_LIST_KEY_ARGS = [
  'filter',
  'teamId',
  'teamKey',
  'projectId',
  'cycleId',
  'milestoneId',
  'parentId',
  'groupBy',
  'ordering',
  'includeArchived',
  'includeSubIssues',
  'subscribed',
  'onlyTrashed',
];

interface ConnectionRef {
  nodes: Reference[];
  pageInfo?: unknown;
  __typename?: string;
}

/**
 * Offset pagination (SPEC §4.9.12 infinite scroll). A request without `after` replaces
 * the list (refresh/refetch); a request with `after` appends, skipping duplicates.
 */
const issueListPolicy: FieldPolicy<ConnectionRef> = {
  keyArgs: ISSUE_LIST_KEY_ARGS,
  merge(existing, incoming, { args }) {
    if (!existing || !args?.after) return incoming;
    const seen = new Set(existing.nodes.map((n) => n.__ref));
    return { ...incoming, nodes: [...existing.nodes, ...incoming.nodes.filter((n) => !seen.has(n.__ref))] };
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cache redirect: `issue(id: <uuid>)` reads the normalized entity so panels open instantly. */
function redirectById(typename: string): FieldPolicy {
  return {
    read(existing, { args, toReference }) {
      if (existing !== undefined) return existing;
      const id = args?.id;
      if (typeof id === 'string' && UUID_RE.test(id)) return toReference({ __typename: typename, id });
      return undefined;
    },
  };
}

const replace = { merge: false } as const;

export function createCache(): InMemoryCache {
  return new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          issues: issueListPolicy,
          issue: redirectById('Issue'),
          project: redirectById('Project'),
          cycle: redirectById('Cycle'),
          teams: replace,
          users: replace,
          labels: replace,
          projects: { keyArgs: ['includeArchived', 'teamId', 'status'], merge: false },
          favorites: replace,
          views: { keyArgs: ['teamId'], merge: false },
          notifications: { keyArgs: ['preset'], merge: false },
          issueGroupCounts: { keyArgs: ISSUE_LIST_KEY_ARGS, merge: false },
          cycles: { keyArgs: ['teamId', 'teamKey', 'includeClosed', 'first'], merge: false },
          search: { keyArgs: ['query', 'types', 'teamId', 'limit'], merge: false },
          apiKeys: replace,
          sessions: replace,
          webhooks: replace,
          importRuns: replace,
          exports: replace,
          invites: replace,
          cyclesClosingSoon: replace,
        },
      },
      Issue: {
        fields: {
          labels: replace,
          labelIds: replace,
          children: replace,
          relations: replace,
          comments: replace,
          activity: replace,
          githubLinks: replace,
          attachments: replace,
          subscribers: replace,
          subIssueRollup: { merge: true },
        },
      },
      Team: { fields: { statuses: replace, members: replace, cycles: replace, upcomingCycles: replace } },
      Project: { fields: { milestones: replace, teams: replace, progress: { merge: true } } },
      Milestone: { fields: { progress: { merge: true } } },
      Comment: { fields: { reactions: replace } },
      Cycle: { fields: { liveStats: { merge: true }, stats: { merge: true }, addedAfterStartIssueIds: replace } },
      View: { fields: { display: { merge: true } } },
      ApiKey: { fields: { mutationsPerHour: replace } },
      GithubInstall: { fields: { repos: replace } },
      // Singletons without ids.
      Workspace: { keyFields: [], fields: { features: { merge: true } } },
      SetupStatus: { keyFields: [] },
      GithubIntegration: { keyFields: [], fields: { installs: replace } },
      McpInfo: { keyFields: [] },
    },
  });
}

/** Collect File/Blob values for the GraphQL multipart request spec. */
function extractFiles(value: unknown, path = 'variables'): { path: string; file: File | Blob }[] {
  if (typeof File !== 'undefined' && (value instanceof File || value instanceof Blob)) return [{ path, file: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => extractFiles(v, `${path}.${i}`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => extractFiles(v, `${path}.${k}`));
  }
  return [];
}

function replaceFiles(value: unknown): unknown {
  if (typeof File !== 'undefined' && (value instanceof File || value instanceof Blob)) return null;
  if (Array.isArray(value)) return value.map(replaceFiles);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, replaceFiles(v)]));
  }
  return value;
}

/** Multipart uploads (uploadAttachment, uploadAvatar) — everything else goes through HttpLink. */
const uploadLink = new ApolloLink((operation, forward) => {
  const files = extractFiles(operation.variables);
  if (files.length === 0) return forward(operation);
  return new Observable((observer) => {
    const form = new FormData();
    form.append(
      'operations',
      JSON.stringify({
        query: print(operation.query),
        variables: replaceFiles(operation.variables),
        operationName: operation.operationName,
      }),
    );
    form.append('map', JSON.stringify(Object.fromEntries(files.map((f, i) => [String(i), [f.path]]))));
    files.forEach((f, i) => form.append(String(i), f.file, f.file instanceof File ? f.file.name : 'blob'));
    const controller = new AbortController();
    fetch('/graphql', {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { 'x-csrf-token': readCsrfToken() ?? '' },
    })
      .then(async (res) => {
        const body: unknown = await res.json();
        observer.next(body as never);
        observer.complete();
      })
      .catch((err: unknown) => observer.error(err));
    return () => controller.abort();
  });
});

const csrfLink = new ApolloLink((operation, forward) => {
  operation.setContext(({ headers = {} }: { headers?: Record<string, string> }) => ({
    headers: { ...headers, 'x-csrf-token': readCsrfToken() ?? '' },
  }));
  return forward(operation);
});

export interface ApolloSetup {
  client: ApolloClient<unknown>;
  ws: WsClient;
}

const AUTH_PROBES = new Set(['Viewer', 'SetupStatus', 'Login', 'SetupWorkspace', 'AcceptInvite', 'InviteInfo']);

export function createApollo(opts: { onUnauthenticated: () => void }): ApolloSetup {
  const connection = useConnection.getState();
  let wasDisconnected = false;
  let client: ApolloClient<unknown> | null = null;

  const ws = createClient({
    url: () => `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/graphql`,
    lazy: true,
    lazyCloseTimeout: 3000,
    keepAlive: 15_000,
    retryAttempts: Number.POSITIVE_INFINITY,
    shouldRetry: () => true,
    // Exponential backoff 1s → 30s with jitter (SPEC §5.5).
    retryWait: (retries) =>
      new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1000 * 2 ** retries) + Math.random() * 300)),
    on: {
      connecting: () => connection.setStatus('connecting'),
      connected: () => {
        connection.setStatus('connected');
        if (wasDisconnected) {
          wasDisconnected = false;
          if (client) runInBackground(client.refetchQueries({ include: 'active' }));
        }
      },
      closed: (event) => {
        // 1000 = normal lazy close with no subscriptions; not an outage.
        const code = (event as { code?: number } | undefined)?.code;
        if (code === 1000) {
          connection.setStatus('idle');
          return;
        }
        wasDisconnected = true;
        connection.setStatus('disconnected');
      },
    },
  });

  const errorLink = onError(({ graphQLErrors, networkError, operation }) => {
    const unauth =
      graphQLErrors?.some((e) => e.extensions?.code === 'UNAUTHENTICATED') ||
      (networkError as { statusCode?: number } | null)?.statusCode === 401;
    if (unauth && !AUTH_PROBES.has(operation.operationName)) opts.onUnauthenticated();
  });

  const http = new HttpLink({ uri: '/graphql', credentials: 'same-origin' });
  const persisted = createPersistedQueryLink({
    generateHash: (document) => {
      const hash = (document as typeof document & { __meta__?: { hash?: string } }).__meta__?.hash;
      if (!hash?.startsWith('sha256:')) throw new Error('App GraphQL operation is missing its generated persisted hash.');
      return hash.slice('sha256:'.length);
    },
  });
  const wsLink = new GraphQLWsLink(ws);
  const link = split(
    ({ query }) => {
      const def = getMainDefinition(query);
      return def.kind === 'OperationDefinition' && def.operation === 'subscription';
    },
    wsLink,
    ApolloLink.from([errorLink, csrfLink, uploadLink, persisted, http]),
  );

  client = new ApolloClient({
    cache: createCache(),
    link,
    defaultOptions: {
      watchQuery: { fetchPolicy: 'cache-and-network', nextFetchPolicy: 'cache-first', errorPolicy: 'none' },
    },
    assumeImmutableResults: true,
  });

  // Coming back online also refetches what is on screen (SPEC §5.5). The socket alone is not
  // enough: a short outage (or WebKit's offline mode) can leave it open while the HTTP refetches
  // its events triggered failed, so nothing else would bring those changes in. When the socket
  // did drop, its `connected` handler refetches instead.
  useConnection.subscribe((state, prev) => {
    if (state.online && !prev.online && !wasDisconnected && client) {
      runInBackground(client.refetchQueries({ include: 'active' }));
    }
  });

  return { client, ws };
}
