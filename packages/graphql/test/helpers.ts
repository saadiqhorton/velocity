import type {} from '../../services/test/helpers/global-setup';
import { execute, parse, specifiedRules, validate } from 'graphql/index.js';
import type { ExecutionResult, GraphQLError, ValidationRule } from 'graphql/index.js';
import { createLoaders, createVelocityPubSub, schema, toGraphQLError } from '../src/index';
import { complexityLimitRule, depthLimitRule } from '../src/index';
import type { ServiceActor } from '../../services/src/index';
import { addMember, apiActor, createHarness, setupOwner } from '../../services/test/helpers/harness';
import type { Harness } from '../../services/test/helpers/harness';

export interface ApiResult {
  data: Record<string, unknown> | null;
  errors: { message: string; extensions: Record<string, unknown> }[];
}

export async function executeApi(
  h: Harness,
  actor: ServiceActor | null,
  source: string,
  variables: Record<string, unknown> = {},
  validationRules: ValidationRule[] = [depthLimitRule(10), complexityLimitRule(50_000)],
): Promise<ApiResult> {
  const document = parse(source);
  const errors = validate(schema, document, [...specifiedRules, ...validationRules]);
  if (errors.length) return { data: null, errors: errors.map((e) => ({ message: e.message, extensions: e.extensions })) };

  const result: ExecutionResult = await execute({
    schema,
    document,
    variableValues: variables,
    contextValue: {
      services: h.services,
      pubsub: createVelocityPubSub(),
      actor,
      sessionId: null,
      sessionToken: null,
      request: { ip: null, userAgent: null, setSession() {}, clearSession() {} },
      loaders: createLoaders(h.services, actor),
    },
  });
  return {
    data: (result.data as Record<string, unknown> | null | undefined) ?? null,
    errors: (result.errors ?? []).map((error: GraphQLError) => {
      const mapped = toGraphQLError(error.originalError ?? error) ?? error;
      return { message: mapped.message, extensions: (mapped.extensions ?? {}) as Record<string, unknown> };
    }),
  };
}

export { addMember, apiActor, createHarness, setupOwner };
export type { Harness, ServiceActor };
