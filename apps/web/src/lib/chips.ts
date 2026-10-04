/**
 * Filter chip helpers (SPEC §3.10, §4.11.6). Chips are canonical in the UI; values are
 * human-readable names (status, label, project, team key, username) so the DSL in the
 * URL stays readable and shareable. "is"/"is not" map to eq|in / neq|nin.
 */
import type { FilterChip } from '@velocity/graphql/dsl';
import type { FilterField, FilterOp, FilterScalar, FilterValue } from '@velocity/schema/filter-ast';

export type ChipField = Extract<
  FilterField,
  'status' | 'statusCategory' | 'assignee' | 'creator' | 'priority' | 'label' | 'project' | 'cycle' | 'team' | 'createdAt' | 'updatedAt' | 'completedAt' | 'title' | 'estimate'
>;

/** Fields offered by "+ Filter", in menu order. */
export const CHIP_FIELDS: ChipField[] = [
  'status',
  'assignee',
  'priority',
  'label',
  'project',
  'cycle',
  'team',
  'creator',
  'statusCategory',
  'estimate',
  'createdAt',
  'updatedAt',
  'completedAt',
  'title',
];

export const DATE_FIELDS: ReadonlySet<FilterField> = new Set(['createdAt', 'updatedAt', 'completedAt']);

/** Relative date presets for date chips: value → amount/unit. */
export const DATE_PRESETS = ['-1d', '-1w', '-2w', '-1m', '-3m', '-6m'] as const;

function scalarToString(s: FilterScalar): string {
  switch (s.kind) {
    case 'me':
      return 'me';
    case 'empty':
      return 'empty';
    case 'string':
    case 'date':
      return s.value;
    case 'number':
      return String(s.value);
    case 'relativeDate':
      return `${s.amount < 0 ? '-' : '+'}${Math.abs(s.amount)}${s.unit}`;
  }
}

/** Raw values of a chip as strings ("me", "empty", names, numbers, "-1w"). */
export function chipValues(chip: FilterChip): string[] {
  return chip.value.kind === 'list' ? chip.value.values.map(scalarToString) : [scalarToString(chip.value)];
}

/** Whether the chip excludes its values ("is not"). */
export function chipIsNegative(chip: FilterChip): boolean {
  const negOp = chip.op === 'neq' || chip.op === 'nin';
  return chip.negated ? !negOp : negOp;
}

function toScalar(field: FilterField, raw: string): FilterScalar {
  if (raw === 'me' && (field === 'assignee' || field === 'creator')) return { kind: 'me' };
  if (raw === 'empty') return { kind: 'empty' };
  if (field === 'priority' || field === 'estimate') return { kind: 'number', value: Number(raw) };
  if (DATE_FIELDS.has(field)) {
    const rel = /^([+-])(\d+)([dwmy])$/.exec(raw);
    if (rel) {
      const n = Number(rel[2]);
      return { kind: 'relativeDate', amount: rel[1] === '-' ? -n : n, unit: rel[3] as 'd' | 'w' | 'm' | 'y' };
    }
    return { kind: 'date', value: raw };
  }
  return { kind: 'string', value: raw };
}

/** Build a set chip ("is" / "is not" one or more values). */
export function makeSetChip(field: FilterField, values: readonly string[], negative = false): FilterChip | null {
  if (values.length === 0) return null;
  const scalars = values.map((v) => toScalar(field, v));
  const multi = scalars.length > 1;
  const op: FilterOp = multi ? (negative ? 'nin' : 'in') : negative ? 'neq' : 'eq';
  const value: FilterValue = multi ? { kind: 'list', values: scalars } : (scalars[0] as FilterScalar);
  return { field, op, value, negated: false };
}

/** Date chip: "after" (gte) or "before" (lt) a relative or absolute date. */
export function makeDateChip(field: FilterField, raw: string, direction: 'after' | 'before'): FilterChip {
  return { field, op: direction === 'after' ? 'gte' : 'lt', value: toScalar(field, raw), negated: false };
}

export function makeTextChip(field: FilterField, text: string): FilterChip {
  return { field, op: 'contains', value: { kind: 'string', value: text }, negated: false };
}

/** Flip "is" ⇄ "is not" (sets) or "after" ⇄ "before" (dates). */
export function flipChip(chip: FilterChip): FilterChip {
  if (DATE_FIELDS.has(chip.field)) {
    const op: FilterOp = chip.op === 'gte' || chip.op === 'gt' ? 'lt' : 'gte';
    return { ...chip, op };
  }
  const values = chipValues(chip);
  return makeSetChip(chip.field, values, !chipIsNegative(chip)) ?? chip;
}

/** Replace the values of a set chip, keeping its polarity. */
export function withValues(chip: FilterChip, values: readonly string[]): FilterChip | null {
  return makeSetChip(chip.field, values, chipIsNegative(chip));
}
