import { GraphQLError } from 'graphql/index.js';

interface OperationParams {
  query?: string | null;
  extensions?: unknown;
}

/** Resolve the generated app manifest while leaving the public GraphQL API open. */
export function persistedOperationQuery(params: OperationParams, documents: Readonly<Record<string, string>>): string | null {
  if (!params.extensions || typeof params.extensions !== 'object') return null;
  const extension = (params.extensions as Record<string, unknown>).persistedQuery;
  if (extension === undefined) return null;
  if (!extension || typeof extension !== 'object') {
    throw new GraphQLError('Invalid persisted query extension.', { extensions: { code: 'BAD_REQUEST' } });
  }
  const { version, sha256Hash } = extension as Record<string, unknown>;
  if (version !== 1 || typeof sha256Hash !== 'string' || !/^[a-f0-9]{64}$/.test(sha256Hash)) {
    throw new GraphQLError('Invalid persisted query extension.', { extensions: { code: 'BAD_REQUEST' } });
  }
  // GraphQL Code Generator prefixes manifest keys with the hash algorithm;
  // Apollo's APQ wire format carries the bare digest.
  const query = documents[`sha256:${sha256Hash}`];
  if (query) return query;
  // Old browser bundles may still be in flight during an upgrade. Apollo retries with
  // its full document when a hash is absent from the new image's manifest.
  if (params.query) return null;
  throw new GraphQLError('PersistedQueryNotFound', { extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } });
}
