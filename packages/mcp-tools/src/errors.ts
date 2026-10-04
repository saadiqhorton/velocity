import type { GraphQLExecutor } from './executor';

export interface ToolErrorInfo {
  code: string;
  message: string;
  caret?: string;
}

/** A failure the agent can act on; surfaces as an MCP tool result with `isError: true`. */
export class ToolError extends Error {
  readonly code: string;
  readonly caret: string | undefined;
  constructor(message: string, code = 'VALIDATION', caret?: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.caret = caret;
  }
}

type GqlErrors = NonNullable<Awaited<ReturnType<GraphQLExecutor>>['errors']>;

/** Turn the first GraphQL error into an actionable ToolError (SPEC §6.1.1 codes). */
export function toToolError(errors: GqlErrors): ToolError {
  const first = errors[0];
  if (!first) return new ToolError('Unknown error from the Velocity API.', 'INTERNAL');
  const ext = first.extensions ?? {};
  const code = typeof ext.code === 'string' ? ext.code : 'INTERNAL';
  const caret = typeof ext.caret === 'string' ? ext.caret : undefined;
  const msg = first.message;
  switch (code) {
    case 'FORBIDDEN':
      return new ToolError(
        `FORBIDDEN: ${msg} If you were trying to create or change something, this API key is probably read-only; ask the key owner for a write-scoped key (Settings > API keys). Otherwise you may not have access to that object.`,
        code,
      );
    case 'VALIDATION':
      return new ToolError(
        `VALIDATION: ${msg}${caret ? `\n\n${caret}\n\nFix the filter_dsl at the caret and retry (see the velocity_guide prompt for the DSL cheat sheet).` : ''}`,
        code,
        caret,
      );
    case 'NOT_FOUND':
      return new ToolError(`NOT_FOUND: ${msg} Check the identifier (e.g. ENG-123) with search_issues or list_issues, and keys with list_teams.`, code);
    case 'CONFLICT':
      return new ToolError(`CONFLICT: ${msg} Re-read the object with get_issue and retry with fresh data.`, code);
    case 'RATE_LIMITED':
      return new ToolError(`RATE_LIMITED: ${msg} Slow down and retry in a little while.`, code);
    case 'UNAUTHENTICATED':
      return new ToolError(`UNAUTHENTICATED: ${msg} Check that VELOCITY_API_KEY is a valid, unexpired key (vel_...).`, code);
    default:
      return new ToolError(`${code}: ${msg}`, code);
  }
}

export function errorInfo(e: ToolError): ToolErrorInfo {
  return { code: e.code, message: e.message, ...(e.caret ? { caret: e.caret } : {}) };
}
