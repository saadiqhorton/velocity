/**
 * The optimistic mutation wrapper (SPEC §5.4, §5.5). ESLint bans `useMutation` everywhere
 * else, so every mutation in the web app declares:
 *   - an optimistic change (or an explicit, reasoned `serverConfirmed` opt-out for results
 *     the client cannot predict: secrets, sessions, imports),
 *   - the rollback flag text shown when the server rejects it,
 *   - typed error → flag mapping (lib/errors.ts),
 *   - an optional "sync pulse" when reconciliation takes longer than 300ms.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';
import { useApolloClient, useMutation } from '@apollo/client';
import type {
  ApolloCache,
  DefaultContext,
  FetchResult,
  InternalRefetchQueriesInclude,
  OperationVariables,
  TypedDocumentNode,
} from '@apollo/client';
import { useFlags } from '@velocity/ui';
import { describeError, runInBackground } from './errors';
import type { DescribedError, ErrorCode } from './errors';
import { useSync } from '@/stores/sync';
import { m } from '@/i18n';

export const PULSE_THRESHOLD_MS = 300;

export interface ServerConfirmed {
  /** Why no optimistic result is possible. Surfaces in code review, not in the UI. */
  serverConfirmed: string;
}

export type OptimisticFactory<TData, TVars> = (vars: TVars, cache: ApolloCache<unknown>) => TData;

export interface MutationContract<TData, TVars> {
  optimistic: OptimisticFactory<TData, TVars> | ServerConfirmed;
  /** Flag title when the change is rolled back. */
  rollback: (vars: TVars) => string;
  /** Cache writes beyond normalization (list inserts, removals). Runs for optimistic and real results. */
  update?: (cache: ApolloCache<unknown>, result: FetchResult<TData>, vars: TVars) => void;
  /** Entity ids whose rows pulse when the server takes longer than 300ms. */
  pulse?: (vars: TVars) => string[];
  /** Skip the error flag (the caller shows the error inline). */
  silent?: boolean | ((code: ErrorCode) => boolean);
  refetchQueries?: InternalRefetchQueriesInclude;
  context?: DefaultContext;
}

export interface MutationRunResult<TData> {
  data: TData | null;
  error: DescribedError | null;
}

export function isServerConfirmed<TData, TVars>(o: MutationContract<TData, TVars>['optimistic']): o is ServerConfirmed {
  return typeof o === 'object' && o !== null && 'serverConfirmed' in o;
}

/** GraphQL list inputs may arrive as a single value (input coercion); normalize to an array. */
export function asArray<T>(value: T | readonly T[]): T[] {
  return Array.isArray(value) ? [...(value as readonly T[])] : [value as T];
}

/** Decide whether to pulse given elapsed reconcile time. Exported for tests. */
export function shouldPulse(elapsedMs: number): boolean {
  return elapsedMs > PULSE_THRESHOLD_MS;
}

export function useOptimisticMutation<TData, TVars extends OperationVariables>(
  document: TypedDocumentNode<TData, TVars>,
  contract: MutationContract<TData, TVars>,
): [(vars: TVars) => Promise<MutationRunResult<TData>>, { loading: boolean }] {
  const client = useApolloClient();
  const [mutate, state] = useMutation(document);
  const { showFlag } = useFlags();
  const pulse = useSync((s) => s.pulse);
  const contractRef = useRef(contract);
  useLayoutEffect(() => {
    contractRef.current = contract;
  });

  const run = useCallback(
    async (vars: TVars): Promise<MutationRunResult<TData>> => {
      const c = contractRef.current;
      const started = performance.now();
      let optimisticResponse: TData | undefined;
      if (!isServerConfirmed(c.optimistic)) {
        try {
          optimisticResponse = c.optimistic(vars, client.cache);
        } catch {
          // The entity is not cached (e.g. a deep link): fall back to the server result.
          optimisticResponse = undefined;
        }
      }
      try {
        const result = await mutate({
          variables: vars,
          optimisticResponse: optimisticResponse as never,
          update: c.update ? (cache, res) => c.update?.(cache as ApolloCache<unknown>, res as FetchResult<TData>, vars) : undefined,
          refetchQueries: c.refetchQueries,
          context: c.context,
        });
        if (c.pulse && optimisticResponse !== undefined && shouldPulse(performance.now() - started)) {
          pulse(c.pulse(vars));
        }
        return { data: (result.data as TData | null | undefined) ?? null, error: null };
      } catch (err) {
        const described = describeError(err);
        const silent = typeof c.silent === 'function' ? c.silent(described.code) : c.silent;
        if (!silent) {
          showFlag({
            title: c.rollback(vars),
            description: described.message,
            severity: 'error',
            action:
              described.code === 'UNAUTHENTICATED'
                ? { label: m.errors.logInAgain, onClick: () => window.location.assign('/login') }
                : undefined,
          });
        }
        if (described.code === 'CONFLICT' || described.code === 'NOT_FOUND') {
          runInBackground(client.refetchQueries({ include: 'active' }));
        }
        return { data: null, error: described };
      }
    },
    [client, mutate, pulse, showFlag],
  );

  return [run, { loading: state.loading }];
}
