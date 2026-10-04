/** Typed service errors, surfaced as GraphQL `extensions.code` (SPEC §6.1.1). */
export type ErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UNAUTHENTICATED';

export class ServiceError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export const notFound = (what: string): ServiceError => new ServiceError('NOT_FOUND', `${what} not found.`);
export const validation = (message: string, details?: Record<string, unknown>): ServiceError =>
  new ServiceError('VALIDATION', message, details);
export const conflict = (message: string, details?: Record<string, unknown>): ServiceError =>
  new ServiceError('CONFLICT', message, details);
export const forbidden = (message = 'You don’t have permission to do that.'): ServiceError =>
  new ServiceError('FORBIDDEN', message);
export const unauthenticated = (message = 'Sign in to continue.'): ServiceError =>
  new ServiceError('UNAUTHENTICATED', message);

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = e?.code ?? e?.cause?.code;
  const c = e?.constraint ?? e?.cause?.constraint;
  return code === '23505' && (!constraint || c === constraint);
}
