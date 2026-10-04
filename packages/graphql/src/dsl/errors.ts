import type { FilterDslErrorInfo } from '@velocity/schema/filter-ast';

/** Build the caret display: the input line followed by a caret under `position`. */
export function buildCaret(input: string, position: number): string {
  const pos = Math.max(0, Math.min(position, input.length));
  return `${input}\n${' '.repeat(pos)}^`;
}

/** Typed error thrown by the filter DSL parser. */
export class DslError extends Error {
  readonly info: FilterDslErrorInfo;

  constructor(info: FilterDslErrorInfo) {
    super(info.message);
    this.name = 'DslError';
    this.info = info;
  }
}

/** Create a DslError pointing at `position` (0-based) in `input`. */
export function dslError(input: string, position: number, message: string): DslError {
  const pos = Math.max(0, Math.min(position, input.length));
  return new DslError({ message, position: pos, caret: buildCaret(input, pos) });
}
