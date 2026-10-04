import { GraphQLError } from 'graphql';
import { ForbiddenError, ServiceError } from '@velocity/services';
import type { ServiceActor } from '@velocity/services';
import { DslError } from './dsl/index';
import type { GqlContext } from './context';

/** Map domain errors to typed GraphQL errors (SPEC §6.1.1 extensions codes). */
export function toGraphQLError(err: unknown): GraphQLError | null {
  if (err instanceof GraphQLError) return err;
  if (err instanceof ServiceError) return new GraphQLError(err.message, { extensions: { code: err.code, ...(err.details ?? {}) } });
  if (err instanceof ForbiddenError) return new GraphQLError(err.message || 'You don’t have permission to do that.', { extensions: { code: 'FORBIDDEN' } });
  if (err instanceof DslError) {
    return new GraphQLError(err.message, { extensions: { code: 'VALIDATION', position: err.info.position, caret: err.info.caret } });
  }
  return null;
}

/** Resolver guard: every non-public operation needs an authenticated actor (SPEC §7.1.4). */
export function requireActor(ctx: GqlContext): ServiceActor {
  if (!ctx.actor) throw new GraphQLError('Sign in to continue.', { extensions: { code: 'UNAUTHENTICATED' } });
  return ctx.actor;
}

export function requireSessionActor(ctx: GqlContext): ServiceActor {
  const a = requireActor(ctx);
  if (a.via !== 'session') {
    throw new GraphQLError('This operation needs a signed-in session, not an API key.', { extensions: { code: 'FORBIDDEN' } });
  }
  return a;
}
