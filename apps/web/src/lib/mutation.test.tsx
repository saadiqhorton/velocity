import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ApolloError, gql, useApolloClient } from '@apollo/client';
import type { ApolloClient, InMemoryCache, TypedDocumentNode } from '@apollo/client';
import { MockedProvider } from '@apollo/client/testing';
import type { MockedResponse } from '@apollo/client/testing';
import { GraphQLError } from 'graphql';
import { createCache } from './apollo';
import { PULSE_THRESHOLD_MS, asArray, isServerConfirmed, shouldPulse, useOptimisticMutation } from './mutation';
import type { MutationContract, MutationRunResult } from './mutation';
import { describeError, errorCode, filterErrorCaret } from './errors';
import { useSync } from '@/stores/sync';
import { m } from '@/i18n';

const showFlag = vi.hoisted(() => vi.fn<(flag: unknown) => string>(() => 'flag-1'));

vi.mock('@velocity/ui', async (orig) => ({
  ...(await orig<typeof import('@velocity/ui')>()),
  useFlags: () => ({ showFlag, dismissFlag: vi.fn() }),
}));

interface Vars {
  id: string;
  title: string;
}
interface Data {
  __typename: 'Mutation';
  renameThing: { __typename: 'Thing'; id: string; title: string };
}

const Rename = gql`
  mutation Rename($id: ID!, $title: String!) {
    renameThing(id: $id, title: $title) {
      id
      title
    }
  }
` as TypedDocumentNode<Data, Vars>;

const ThingFragment = gql`
  fragment ThingParts on Thing {
    id
    title
  }
`;

const vars: Vars = { id: '1', title: 'new' };

function serverResult(title: string): { data: Data } {
  return { data: { __typename: 'Mutation', renameThing: { __typename: 'Thing', id: '1', title } } };
}

function okMock(title = 'server', delay = 20): MockedResponse {
  return { request: { query: Rename, variables: vars }, result: serverResult(title), delay };
}

function errorMock(code: string, delay = 20): MockedResponse {
  return {
    request: { query: Rename, variables: vars },
    result: { errors: [new GraphQLError('nope', { extensions: { code } })] },
    delay,
  };
}

function baseContract(over: Partial<MutationContract<Data, Vars>> = {}): MutationContract<Data, Vars> {
  return {
    optimistic: (v) => ({ __typename: 'Mutation', renameThing: { __typename: 'Thing', id: v.id, title: v.title } }),
    rollback: (v) => `Could not rename to ${v.title}`,
    ...over,
  };
}

interface Harness {
  run: (v: Vars) => Promise<MutationRunResult<Data>>;
  client: ApolloClient<unknown>;
  cache: InMemoryCache;
  title: (optimistic?: boolean) => string | undefined;
}

function mount(mocks: MockedResponse[], contract: MutationContract<Data, Vars>, seed = true): Harness {
  const cache = createCache();
  if (seed) {
    cache.writeFragment({
      id: 'Thing:1',
      fragment: ThingFragment,
      data: { __typename: 'Thing', id: '1', title: 'old' },
    });
  }
  const h = {} as Harness;
  function Probe() {
    const client = useApolloClient();
    const [run] = useOptimisticMutation(Rename, contract);
    h.run = run;
    h.client = client;
    return null;
  }
  render(
    <MockedProvider mocks={mocks} cache={cache}>
      <Probe />
    </MockedProvider>,
  );
  h.cache = cache;
  h.title = (optimistic = true) =>
    cache.readFragment<{ title: string }>({ id: 'Thing:1', fragment: ThingFragment, optimistic })?.title;
  return h;
}

beforeEach(() => {
  showFlag.mockClear();
  useSync.setState({ pulses: {} });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useOptimisticMutation', () => {
  it('(a) shows the optimistic value in the cache immediately, before the server answers', async () => {
    const h = mount([okMock('server', 100)], baseContract());
    expect(h.title()).toBe('old');
    const pending = h.run(vars);
    // Optimistic layer: visible to optimistic reads, the base cache is untouched.
    await waitFor(() => expect(h.title(true)).toBe('new'));
    expect(h.title(false)).toBe('old');
    await pending;
  });

  it('(b) writes the server value and resolves { data, error: null }', async () => {
    const h = mount([okMock('server from api')], baseContract());
    const result = await h.run(vars);
    expect(result.error).toBeNull();
    expect(result.data?.renameThing.title).toBe('server from api');
    expect(h.title(false)).toBe('server from api');
    expect(h.title(true)).toBe('server from api');
    expect(showFlag).not.toHaveBeenCalled();
  });

  it('(c) rolls back, flags with the rollback title and returns the typed error', async () => {
    const h = mount([errorMock('VALIDATION', 50)], baseContract());
    const pending = h.run(vars);
    await waitFor(() => expect(h.title()).toBe('new'));
    const result = await pending;
    expect(h.title(true)).toBe('old');
    expect(h.title(false)).toBe('old');
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('VALIDATION');
    expect(result.error?.serverMessage).toBe('nope');
    expect(showFlag).toHaveBeenCalledTimes(1);
    const flag = showFlag.mock.calls[0]?.[0] as unknown as { title: string; severity: string; description: string; action?: unknown };
    expect(flag.title).toBe(baseContract().rollback(vars));
    expect(flag.severity).toBe('error');
    expect(flag.description).toBe(`Nope. ${m.errors.VALIDATION}`);
    expect(flag.action).toBeUndefined();
  });

  it('never throws: network errors resolve with NETWORK', async () => {
    const h = mount([{ request: { query: Rename, variables: vars }, error: new Error('offline') }], baseContract());
    const result = await h.run(vars);
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('NETWORK');
    expect(h.title()).toBe('old');
    expect(showFlag).toHaveBeenCalledTimes(1);
  });

  it('(d) silent: true suppresses the flag but still returns the error and rolls back', async () => {
    const h = mount([errorMock('FORBIDDEN')], baseContract({ silent: true }));
    const result = await h.run(vars);
    expect(showFlag).not.toHaveBeenCalled();
    expect(result.error?.code).toBe('FORBIDDEN');
    expect(h.title()).toBe('old');
  });

  it('(d) silent as a function receives the error code', async () => {
    const silent = vi.fn((code: string) => code === 'VALIDATION');
    const h1 = mount([errorMock('VALIDATION')], baseContract({ silent }));
    await h1.run(vars);
    expect(silent).toHaveBeenCalledWith('VALIDATION');
    expect(showFlag).not.toHaveBeenCalled();
  });

  it('(d) silent function returning false still flags', async () => {
    const h = mount([errorMock('FORBIDDEN')], baseContract({ silent: (code) => code === 'VALIDATION' }));
    await h.run(vars);
    expect(showFlag).toHaveBeenCalledTimes(1);
  });

  it('(e) serverConfirmed contracts send no optimistic response', async () => {
    const h = mount([okMock('server', 80)], { optimistic: { serverConfirmed: 'server mints it' }, rollback: () => 'x' });
    const pending = h.run(vars);
    await new Promise((r) => setTimeout(r, 30));
    expect(h.title(true)).toBe('old');
    const result = await pending;
    expect(result.data?.renameThing.title).toBe('server');
    expect(h.title(false)).toBe('server');
  });

  it('(f) an optimistic factory that throws falls back to the server result', async () => {
    const factory = vi.fn((_v: Vars, cache: { readFragment: (o: unknown) => unknown }) => {
      const t = cache.readFragment({ id: 'Thing:1', fragment: ThingFragment }) as { title: string } | null;
      if (!t) throw new Error('not cached');
      return { __typename: 'Mutation' as const, renameThing: { __typename: 'Thing' as const, id: '1', title: t.title + '!' } };
    });
    const h = mount([okMock('server', 40)], baseContract({ optimistic: factory as never }), false);
    const result = await h.run(vars);
    expect(factory).toHaveBeenCalled();
    expect(result.error).toBeNull();
    expect(result.data?.renameThing.title).toBe('server');
    expect(h.title(false)).toBe('server');
    expect(showFlag).not.toHaveBeenCalled();
  });

  it('passes vars and the cache to the optimistic factory', async () => {
    const factory = vi.fn(baseContract().optimistic as never);
    const h = mount([okMock()], baseContract({ optimistic: factory }));
    await h.run(vars);
    expect(factory).toHaveBeenCalledWith(vars, h.cache);
  });

  it('runs `update` with the result and vars for the optimistic and the real result', async () => {
    const update = vi.fn();
    const h = mount([okMock('server', 30)], baseContract({ update }));
    await h.run(vars);
    expect(update.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of update.mock.calls) expect(call[2]).toEqual(vars);
    const titles = update.mock.calls.map((c) => (c[1] as { data: Data }).data.renameThing.title);
    expect(titles).toContain('new');
    expect(titles).toContain('server');
  });

  it('uses the latest contract (not the one from the first render)', async () => {
    const cache = createCache();
    const rollbackA = vi.fn(() => 'A');
    const rollbackB = vi.fn(() => 'B');
    let run: ((v: Vars) => Promise<MutationRunResult<Data>>) | undefined;
    function Probe({ which }: { which: 'a' | 'b' }) {
      const [r] = useOptimisticMutation(Rename, { optimistic: { serverConfirmed: 'x' }, rollback: which === 'a' ? rollbackA : rollbackB });
      run = r;
      return null;
    }
    const tree = (which: 'a' | 'b') => (
      <MockedProvider mocks={[errorMock('CONFLICT')]} cache={cache}>
        <Probe which={which} />
      </MockedProvider>
    );
    const r = render(tree('a'));
    r.rerender(tree('b'));
    await run?.(vars);
    expect(rollbackA).not.toHaveBeenCalled();
    expect(rollbackB).toHaveBeenCalled();
  });

  describe('(g) sync pulse', () => {
    it('shouldPulse threshold is strictly greater than 300ms', () => {
      expect(PULSE_THRESHOLD_MS).toBe(300);
      expect(shouldPulse(0)).toBe(false);
      expect(shouldPulse(300)).toBe(false);
      expect(shouldPulse(300.01)).toBe(true);
      expect(shouldPulse(5000)).toBe(true);
    });
    it('pushes pulse ids when reconcile takes longer than 300ms', async () => {
      const pulse = vi.fn((v: Vars) => [`Thing:${v.id}`]);
      const h = mount([okMock('server', 400)], baseContract({ pulse }));
      await h.run(vars);
      expect(pulse).toHaveBeenCalledWith(vars);
      expect(Object.keys(useSync.getState().pulses)).toEqual(['Thing:1']);
    });
    it('does not pulse for fast reconciles', async () => {
      const pulse = vi.fn((v: Vars) => [`Thing:${v.id}`]);
      const h = mount([okMock('server', 10)], baseContract({ pulse }));
      await h.run(vars);
      expect(pulse).not.toHaveBeenCalled();
      expect(useSync.getState().pulses).toEqual({});
    });
    it('does not pulse without an optimistic response (nothing to reconcile)', async () => {
      const pulse = vi.fn(() => ['Thing:1']);
      const h = mount([okMock('server', 400)], { optimistic: { serverConfirmed: 'x' }, rollback: () => 'x', pulse });
      await h.run(vars);
      expect(pulse).not.toHaveBeenCalled();
    });
    it('does not pulse on failure', async () => {
      const pulse = vi.fn(() => ['Thing:1']);
      const h = mount([errorMock('VALIDATION', 400)], baseContract({ pulse }));
      await h.run(vars);
      expect(useSync.getState().pulses).toEqual({});
    });
    it('pulses expire after ~220ms', async () => {
      useSync.getState().pulse(['x']);
      expect(Object.keys(useSync.getState().pulses)).toEqual(['x']);
      await waitFor(() => expect(useSync.getState().pulses).toEqual({}), { timeout: 1000 });
    });
    it('pulse([]) is a no-op', () => {
      useSync.getState().pulse([]);
      expect(useSync.getState().pulses).toEqual({});
    });
  });

  it('(h) UNAUTHENTICATED adds a Log in action', async () => {
    const h = mount([errorMock('UNAUTHENTICATED')], baseContract());
    const result = await h.run(vars);
    expect(result.error?.code).toBe('UNAUTHENTICATED');
    const flag = showFlag.mock.calls[0]?.[0] as unknown as { action?: { label: string; onClick: () => void } };
    expect(flag.action?.label).toBe('Log in');
    expect(typeof flag.action?.onClick).toBe('function');
  });

  it('401 network errors also offer Log in', async () => {
    const h = mount(
      [{ request: { query: Rename, variables: vars }, error: Object.assign(new Error('401'), { statusCode: 401 }) }],
      baseContract(),
    );
    const result = await h.run(vars);
    expect(result.error?.code).toBe('UNAUTHENTICATED');
    const flag = showFlag.mock.calls[0]?.[0] as unknown as { action?: { label: string } };
    expect(flag.action?.label).toBe('Log in');
  });

  it('other codes get no action', async () => {
    const h = mount([errorMock('NOT_FOUND')], baseContract());
    await h.run(vars);
    const flag = showFlag.mock.calls[0]?.[0] as unknown as { action?: unknown };
    expect(flag.action).toBeUndefined();
  });

  it('CONFLICT refetches active queries without failing the run', async () => {
    const h = mount([errorMock('CONFLICT')], baseContract());
    const spy = vi.spyOn(h.client, 'refetchQueries').mockResolvedValue([] as never);
    const result = await h.run(vars);
    expect(spy).toHaveBeenCalledWith({ include: 'active' });
    expect(result.error?.code).toBe('CONFLICT');
  });
});

describe('helpers', () => {
  it('(i) asArray', () => {
    expect(asArray('a')).toEqual(['a']);
    expect(asArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(asArray([])).toEqual([]);
    const src = ['a'] as const;
    expect(asArray(src)).not.toBe(src);
    expect(asArray(0)).toEqual([0]);
  });
  it('isServerConfirmed', () => {
    expect(isServerConfirmed({ serverConfirmed: 'why' })).toBe(true);
    expect(isServerConfirmed(() => ({}) as never)).toBe(false);
  });
});

describe('describeError / errorCode', () => {
  const gqlError = (code: string | undefined, message = 'the server says no'): ApolloError =>
    new ApolloError({
      graphQLErrors: [new GraphQLError(message, code ? { extensions: { code } } : undefined)],
    });

  it('keeps the server sentence for VALIDATION, CONFLICT, FORBIDDEN and NOT_FOUND', () => {
    expect(describeError(gqlError('VALIDATION')).message).toBe(`The server says no. ${m.errors.VALIDATION}`);
    for (const code of ['CONFLICT', 'FORBIDDEN', 'NOT_FOUND'] as const) {
      const d = describeError(gqlError(code));
      expect(d.code).toBe(code);
      expect(d.message).toBe('The server says no.');
      expect(d.serverMessage).toBe('the server says no');
    }
  });
  it('does not double the period when the server sentence already ends one', () => {
    expect(describeError(gqlError('FORBIDDEN', 'No access.')).message).toBe('No access.');
    expect(describeError(gqlError('FORBIDDEN', 'Really?')).message).toBe('Really?');
  });
  it('uses the catalog text for other typed codes', () => {
    expect(describeError(gqlError('UNAUTHENTICATED')).message).toBe(m.errors.UNAUTHENTICATED);
    expect(describeError(gqlError('RATE_LIMITED')).message).toBe(m.errors.RATE_LIMITED);
  });
  it('falls back to the catalog when the typed server message is empty', () => {
    expect(describeError(gqlError('VALIDATION', '')).message).toBe(m.errors.VALIDATION);
  });
  it('unknown or missing codes are UNKNOWN', () => {
    expect(errorCode(gqlError('SOMETHING_ELSE'))).toBe('UNKNOWN');
    expect(errorCode(gqlError(undefined))).toBe('UNKNOWN');
    expect(describeError(gqlError('SOMETHING_ELSE')).message).toBe(m.errors.UNKNOWN);
    expect(describeError('boom').code).toBe('UNKNOWN');
    expect(describeError(null).code).toBe('UNKNOWN');
  });
  it('network errors map to NETWORK', () => {
    const e = new ApolloError({ networkError: new Error('Failed to fetch') });
    expect(describeError(e)).toEqual({ code: 'NETWORK', message: m.errors.NETWORK, serverMessage: null });
    expect(errorCode(new TypeError('Failed to fetch'))).toBe('NETWORK');
  });
  it('HTTP 401 maps to UNAUTHENTICATED and 429 to RATE_LIMITED', () => {
    const net = (statusCode: number) => new ApolloError({ networkError: Object.assign(new Error('x'), { statusCode }) });
    expect(errorCode(net(401))).toBe('UNAUTHENTICATED');
    expect(errorCode(net(429))).toBe('RATE_LIMITED');
    expect(errorCode(net(500))).toBe('NETWORK');
  });
  it('typed GraphQL code wins over a network error', () => {
    const e = new ApolloError({
      graphQLErrors: [new GraphQLError('x', { extensions: { code: 'FORBIDDEN' } })],
      networkError: new Error('y'),
    });
    expect(errorCode(e)).toBe('FORBIDDEN');
  });
  it('accepts duck-typed errors carrying graphQLErrors', () => {
    expect(errorCode({ graphQLErrors: [{ message: 'm', extensions: { code: 'CONFLICT' } }] })).toBe('CONFLICT');
  });
});

describe('filterErrorCaret', () => {
  it('returns the caret from the first GraphQL error', () => {
    const caret = 'status:\n       ^';
    const e = new ApolloError({ graphQLErrors: [new GraphQLError('bad', { extensions: { code: 'VALIDATION', caret } })] });
    expect(filterErrorCaret(e)).toBe(caret);
  });
  it('is null without a caret or with a non-string caret', () => {
    expect(filterErrorCaret(new ApolloError({ graphQLErrors: [new GraphQLError('bad')] }))).toBeNull();
    expect(filterErrorCaret(new ApolloError({ graphQLErrors: [new GraphQLError('bad', { extensions: { caret: 5 } })] }))).toBeNull();
    expect(filterErrorCaret(new Error('x'))).toBeNull();
    expect(filterErrorCaret(undefined)).toBeNull();
  });
});
