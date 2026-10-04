/**
 * Filter DSL abstract syntax tree (SPEC §6.1.4). This file is the contract between the
 * parser (packages/graphql/src/dsl — pure), the SQL compiler (packages/services) and the
 * web filter chips (apps/web). Pure types + constants only.
 *
 * Grammar summary (see packages/graphql/src/dsl/README.md for the full EBNF):
 *   query      := expr? orderClause?
 *   expr       := orExpr
 *   orExpr     := andExpr ('or' andExpr)*
 *   andExpr    := unary (('and')? unary)*          -- juxtaposition means AND
 *   unary      := 'not' unary | '(' expr ')' | comparison
 *   comparison := field ':' value                  -- op defaults to eq
 *               | field op ':' value               -- e.g. `priority lt:2`, `priority in:0,1`
 *   orderClause:= 'order:' orderTerm (',' orderTerm)*
 *   orderTerm  := orderField ('asc' | 'desc')?
 */

export const FILTER_FIELDS = [
  'team',
  'status',
  'statusCategory',
  'assignee',
  'creator',
  'priority',
  'label',
  'project',
  'cycle',
  'estimate',
  'createdAt',
  'updatedAt',
  'completedAt',
  'title',
  'description',
  'identifier',
  'parent',
  'relations',
] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'startsWith',
  'endsWith',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const ORDER_FIELDS = [
  'priority',
  'status',
  'createdAt',
  'updatedAt',
  'completedAt',
  'estimate',
  'manual',
  'title',
  'identifier',
] as const;
export type OrderField = (typeof ORDER_FIELDS)[number];

export const RELATION_FILTER_VALUES = ['blocks', 'blockedBy', 'related', 'duplicate'] as const;
export type RelationFilterValue = (typeof RELATION_FILTER_VALUES)[number];

/** A single scalar value inside a comparison or list. */
export type FilterScalar =
  /** `me` — the authenticated actor (assignee/creator only). */
  | { kind: 'me' }
  /** `empty` — null / no value / empty set. */
  | { kind: 'empty' }
  /** Bare word or quoted string, unescaped. Names are matched case-insensitively by the compiler. */
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  /** Absolute date/time — ISO 8601 (`2026-01-31` or full timestamp). */
  | { kind: 'date'; value: string }
  /** Relative date, e.g. `-2w` → { amount: -2, unit: 'w' }. Relative to "now" at compile time. */
  | { kind: 'relativeDate'; amount: number; unit: 'd' | 'w' | 'm' | 'y' };

export type FilterValue = FilterScalar | { kind: 'list'; values: FilterScalar[] };

export interface FilterComparison {
  type: 'cmp';
  field: FilterField;
  op: FilterOp;
  value: FilterValue;
}

export type FilterNode =
  | FilterComparison
  | { type: 'and'; children: FilterNode[] }
  | { type: 'or'; children: FilterNode[] }
  | { type: 'not'; child: FilterNode };

export interface FilterOrder {
  field: OrderField;
  direction: 'asc' | 'desc';
}

export interface FilterQuery {
  /** null = match everything */
  filter: FilterNode | null;
  order: FilterOrder[];
}

/** Typed DSL error (surfaced as GraphQL `VALIDATION` with a caret). */
export interface FilterDslErrorInfo {
  message: string;
  /** 0-based character offset into the input where the error was detected. */
  position: number;
  /** The input line followed by a newline and a caret (`^`) under `position`. */
  caret: string;
}
