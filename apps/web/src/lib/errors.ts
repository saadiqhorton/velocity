import { ApolloError } from '@apollo/client';
import type { GraphQLFormattedError } from 'graphql';
import { m } from '@/i18n';

export type ErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UNAUTHENTICATED'
  | 'NETWORK'
  | 'UNKNOWN';

const KNOWN: ReadonlySet<string> = new Set([
  'NOT_FOUND',
  'FORBIDDEN',
  'VALIDATION',
  'CONFLICT',
  'RATE_LIMITED',
  'UNAUTHENTICATED',
]);

export interface DescribedError {
  code: ErrorCode;
  /** Human sentence with a recovery step (SPEC §4.14). */
  message: string;
  /** Raw server message, when the server sent one for a typed error. */
  serverMessage: string | null;
}

function firstGraphQLError(err: unknown): GraphQLFormattedError | null {
  if (err instanceof ApolloError) return err.graphQLErrors[0] ?? null;
  if (err && typeof err === 'object' && 'graphQLErrors' in err) {
    const list = (err as { graphQLErrors?: GraphQLFormattedError[] }).graphQLErrors;
    return list?.[0] ?? null;
  }
  return null;
}

export function errorCode(err: unknown): ErrorCode {
  const gql = firstGraphQLError(err);
  const code = gql?.extensions?.code;
  if (typeof code === 'string' && KNOWN.has(code)) return code as ErrorCode;
  if (err instanceof ApolloError && err.networkError) {
    const status = (err.networkError as { statusCode?: number }).statusCode;
    if (status === 401) return 'UNAUTHENTICATED';
    if (status === 429) return 'RATE_LIMITED';
    return 'NETWORK';
  }
  if (err instanceof TypeError) return 'NETWORK';
  return 'UNKNOWN';
}

/** Typed error → human sentence. VALIDATION/CONFLICT/FORBIDDEN keep the server's sentence. */
export function describeError(err: unknown): DescribedError {
  const code = errorCode(err);
  const gql = firstGraphQLError(err);
  const serverMessage = gql?.message ?? null;
  const fallback = m.errors[code];
  const useServer = serverMessage && (code === 'VALIDATION' || code === 'CONFLICT' || code === 'FORBIDDEN' || code === 'NOT_FOUND');
  const message = useServer ? `${ensureSentence(serverMessage)} ${code === 'VALIDATION' ? m.errors.VALIDATION : ''}`.trim() : fallback;
  return { code, message, serverMessage };
}

function ensureSentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const cap = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

/** DSL errors carry a caret; returns it when present. */
export function filterErrorCaret(err: unknown): string | null {
  const caret = firstGraphQLError(err)?.extensions?.caret;
  return typeof caret === 'string' ? caret : null;
}

/**
 * True for failures that only mean "the request never completed": offline, a fetch cancelled by
 * navigation (WebKit: "Fetch API cannot load … due to access control checks"), an aborted request.
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError') return true;
  return errorCode(err) === 'NETWORK';
}

/**
 * Runs a fire-and-forget promise (background refetch, prefetch) without leaving an unhandled
 * rejection. Transient network failures are dropped: Apollo already exposes query errors through
 * the query's `error` state and the offline banner. Anything else is logged, never thrown.
 */
export function runInBackground(promise: PromiseLike<unknown>): void {
  Promise.resolve(promise).catch((err: unknown) => {
    if (isTransientNetworkError(err)) return;
    console.error(err);
  });
}
