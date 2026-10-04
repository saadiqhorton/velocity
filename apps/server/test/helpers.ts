import type {} from '../../../packages/services/test/helpers/global-setup';
import { createHarness } from '../../../packages/services/test/helpers/harness';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { ServerConfig } from '../src/config';

export async function boot(overrides: Partial<ServerConfig> = {}) {
  const h = await createHarness();
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://velocity:velocity@localhost:54320/postgres');
  url.pathname = `/${h.dbName}`;
  const config = loadConfig({ DATABASE_URL: url.toString(), APP_SECRET: h.config.appSecret, LOG_LEVEL: 'silent' });
  const app = await createApp({ ...config, app: h.config, port: 0, host: '127.0.0.1', ...overrides }, { inlineJobs: true });
  const { port } = await app.listen();
  const base = `http://127.0.0.1:${port}`;
  return {
    h, app, base,
    async gql(query: string, variables: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
      const response = await fetch(`${base}/graphql`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ query, variables }),
      });
      const body = await response.json() as { data?: Record<string, unknown>; errors?: { message: string; extensions: Record<string, unknown> }[] };
      return { response, body };
    },
    async close() { await app.close(); await h.close(); },
  };
}

export type RunningApp = Awaited<ReturnType<typeof boot>>;
