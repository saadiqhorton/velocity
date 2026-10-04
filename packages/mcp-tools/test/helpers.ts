// Pulls in the ProvidedContext augmentation used by the shared harness.
import type {} from '../../services/test/helpers/global-setup';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
// Same graphql instance as the schema (resolved from packages/graphql's node_modules).
import { graphql } from 'graphql/index.js'; // explicit CJS entry: same instance Pothos uses (avoids a dual-package copy)
import { createLoaders, createVelocityPubSub, schema, toGraphQLError } from '../../graphql/src/index';
import type { ServiceActor } from '../../services/src/index';
import { addMember, apiActor, createHarness, setupOwner } from '../../services/test/helpers/harness';
import type { Harness } from '../../services/test/helpers/harness';
import { createVelocityMcpServer } from '../src/index';
import type { GraphQLExecutor } from '../src/index';

export function inProcessExecutor(h: Harness, actor: ServiceActor | null): GraphQLExecutor {
  return async (query, variables) => {
    const ctx = {
      services: h.services,
      pubsub: createVelocityPubSub(),
      actor,
      sessionId: null,
      sessionToken: null,
      request: { ip: null, userAgent: null, setSession() {}, clearSession() {} },
      loaders: createLoaders(h.services, actor), // fresh loaders per request
    };
    const res = await graphql({ schema, source: query, variableValues: variables ?? {}, contextValue: ctx });
    const out: Awaited<ReturnType<GraphQLExecutor>> = { data: res.data };
    if (res.errors) {
      out.errors = res.errors.map((e) => {
        const mapped = toGraphQLError(e.originalError ?? e) ?? e;
        return { message: mapped.message, extensions: (mapped.extensions ?? {}) as Record<string, unknown> };
      });
    }
    return out;
  };
}

export async function connect(executor: GraphQLExecutor): Promise<{ client: Client; close(): Promise<void> }> {
  const server = createVelocityMcpServer({ executor });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export interface Call {
  isError: boolean;
  text: string;
  data: Record<string, unknown>;
}

export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Call> {
  const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const first = res.content[0];
  return {
    isError: res.isError === true,
    text: first && first.type === 'text' ? first.text : '',
    data: (res.structuredContent ?? {}) as Record<string, unknown>,
  };
}

export { addMember, apiActor, createHarness, setupOwner };
export type { Harness, ServiceActor };
