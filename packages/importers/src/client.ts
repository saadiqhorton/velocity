export interface ClientOptions {
  url: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export class GraphQLRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphQLRequestError';
  }
}

export const CREATE_IMPORT_RUN = `mutation CreateImportRun($input: CreateImportRunInput!) { createImportRun(input: $input) { id status suggestedMapping } }`;
export const UPDATE_IMPORT_MAPPING = `mutation UpdateImportMapping($id: ID!, $mapping: JSON!) { updateImportMapping(id: $id, mapping: $mapping) { id status } }`;
export const DRY_RUN_IMPORT = `mutation DryRunImport($id: ID!) { dryRunImport(id: $id) { id status report } }`;
export const COMMIT_IMPORT = `mutation CommitImport($id: ID!) { commitImport(id: $id) { id status progress } }`;
export const IMPORT_RUN = `query ImportRun($id: ID!) { importRun(id: $id) { id status progress report error } }`;

export type ImportRunStatus = 'mapping' | 'ready' | 'committing' | 'completed' | 'failed' | 'canceled';

export interface VelocityClient {
  request<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

/** Minimal GraphQL client for the Velocity server (`${url}/graphql`). */
export function createClient(opts: ClientOptions): VelocityClient {
  const endpoint = `${opts.url.replace(/\/+$/, '')}/graphql`;
  const doFetch = opts.fetch ?? globalThis.fetch;
  return {
    async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      let res: Response;
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: opts.apiKey },
          body: JSON.stringify({ query, variables }),
        });
      } catch (e) {
        throw new GraphQLRequestError(`Could not reach ${endpoint}: ${e instanceof Error ? e.message : String(e)}`);
      }
      const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
      if (body?.errors?.length) throw new GraphQLRequestError(body.errors[0]?.message ?? 'Unknown GraphQL error');
      if (!res.ok || !body?.data) throw new GraphQLRequestError(`Server responded with HTTP ${res.status}`);
      return body.data;
    },
  };
}
