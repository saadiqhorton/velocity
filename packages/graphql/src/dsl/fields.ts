import { FILTER_FIELDS, ORDER_FIELDS, RELATION_FILTER_VALUES } from '@velocity/schema/filter-ast';
import type {
  FilterField,
  FilterOp,
  FilterScalar,
  OrderField,
} from '@velocity/schema/filter-ast';
import { STATUS_CATEGORIES } from '@velocity/schema/enums';
import { dslError } from './errors';

export type FilterValueKind = 'me' | 'empty' | 'string' | 'number' | 'date' | 'relativeDate';

export interface FilterFieldSpec {
  label: string;
  ops: FilterOp[];
  values: FilterValueKind[];
  enumValues?: readonly string[];
}

const SET_OPS: FilterOp[] = ['eq', 'neq', 'in', 'nin'];
const CMP_OPS: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];
const NUM_OPS: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin'];
const TEXT_OPS: FilterOp[] = ['eq', 'neq', 'contains', 'startsWith', 'endsWith'];

export const PRIORITY_ALIASES: Readonly<Record<string, number>> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
  no_priority: 4,
};

/** Metadata used by the UI to build filter chips and by the parser for validation. */
export const FILTER_FIELD_SPECS: Record<FilterField, FilterFieldSpec> = {
  team: { label: 'Team', ops: [...SET_OPS], values: ['string'] },
  status: { label: 'Status', ops: [...SET_OPS], values: ['string'] },
  statusCategory: {
    label: 'Status category',
    ops: [...SET_OPS],
    values: ['string'],
    enumValues: STATUS_CATEGORIES,
  },
  assignee: { label: 'Assignee', ops: [...SET_OPS], values: ['me', 'empty', 'string'] },
  creator: { label: 'Creator', ops: [...SET_OPS], values: ['me', 'empty', 'string'] },
  priority: {
    label: 'Priority',
    ops: [...NUM_OPS],
    values: ['number'],
    enumValues: Object.keys(PRIORITY_ALIASES),
  },
  label: { label: 'Label', ops: [...SET_OPS], values: ['string', 'empty'] },
  project: { label: 'Project', ops: [...SET_OPS], values: ['string', 'empty'] },
  cycle: {
    label: 'Cycle',
    ops: [...SET_OPS],
    values: ['string', 'empty'],
    enumValues: ['current', 'next', 'previous'],
  },
  estimate: { label: 'Estimate', ops: [...NUM_OPS], values: ['number', 'empty'] },
  createdAt: { label: 'Created', ops: ['eq', 'gt', 'gte', 'lt', 'lte'], values: ['date', 'relativeDate'] },
  updatedAt: { label: 'Updated', ops: ['eq', 'gt', 'gte', 'lt', 'lte'], values: ['date', 'relativeDate'] },
  completedAt: {
    label: 'Completed',
    ops: [...CMP_OPS],
    values: ['date', 'relativeDate', 'empty'],
  },
  title: { label: 'Title', ops: [...TEXT_OPS], values: ['string'] },
  description: { label: 'Description', ops: [...TEXT_OPS], values: ['string'] },
  identifier: { label: 'Identifier', ops: ['eq', 'in'], values: ['string'] },
  parent: { label: 'Parent', ops: ['eq', 'neq'], values: ['empty', 'string'] },
  relations: {
    label: 'Relations',
    ops: ['eq', 'neq'],
    values: ['string', 'empty'],
    enumValues: RELATION_FILTER_VALUES,
  },
};

const FIELD_LOOKUP = new Map<string, FilterField>();
for (const f of FILTER_FIELDS) FIELD_LOOKUP.set(f.toLowerCase(), f);
FIELD_LOOKUP.set('created', 'createdAt');
FIELD_LOOKUP.set('updated', 'updatedAt');
FIELD_LOOKUP.set('completed', 'completedAt');

const ORDER_LOOKUP = new Map<string, OrderField>();
for (const f of ORDER_FIELDS) ORDER_LOOKUP.set(f.toLowerCase(), f);
ORDER_LOOKUP.set('created', 'createdAt');
ORDER_LOOKUP.set('updated', 'updatedAt');
ORDER_LOOKUP.set('completed', 'completedAt');

const OP_LOOKUP = new Map<string, FilterOp>();
for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'startsWith', 'endsWith'] as const) {
  OP_LOOKUP.set(op.toLowerCase(), op);
}

export function resolveField(name: string): FilterField | undefined {
  return FIELD_LOOKUP.get(name.toLowerCase());
}
export function resolveOrderField(name: string): OrderField | undefined {
  return ORDER_LOOKUP.get(name.toLowerCase());
}
export function resolveOp(name: string): FilterOp | undefined {
  return OP_LOOKUP.get(name.toLowerCase());
}

/** Default direction for an order field when omitted. */
export function defaultDirection(field: OrderField): 'asc' | 'desc' {
  return field === 'createdAt' || field === 'updatedAt' || field === 'completedAt' ? 'desc' : 'asc';
}

/** Map of `is:` shorthands to relation filter values. */
export const IS_SHORTHANDS: Readonly<Record<string, 'blockedBy' | 'blocks' | 'duplicate' | 'related'>> = {
  blocked: 'blockedBy',
  blocking: 'blocks',
  duplicate: 'duplicate',
  related: 'related',
};

export interface RawScalar {
  text: string;
  quoted: boolean;
  pos: number;
}

const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9]{0,9}-\d+$/;
const ABS_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ABS_TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/i;
const REL_RE = /^([+-])(\d+)([dwmy])$/i;
const DUR_RE = /^([+-]?)P(\d+)([dwmy])$/i;

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, 1));
  dt.setUTCFullYear(y);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

function coerceDate(input: string, raw: RawScalar, field: FilterField): FilterScalar {
  const t = raw.text;
  const abs = ABS_DATE_RE.exec(t);
  if (abs) {
    if (!validDay(Number(abs[1]), Number(abs[2]), Number(abs[3]))) {
      throw dslError(input, raw.pos, `Invalid date '${t}'`);
    }
    return { kind: 'date', value: t };
  }
  const ts = ABS_TS_RE.exec(t);
  if (ts) {
    const ok =
      validDay(Number(ts[1]), Number(ts[2]), Number(ts[3])) &&
      Number(ts[4]) <= 23 &&
      Number(ts[5]) <= 59 &&
      (ts[6] === undefined || Number(ts[6]) <= 59);
    if (!ok) throw dslError(input, raw.pos, `Invalid timestamp '${t}'`);
    return { kind: 'date', value: t };
  }
  const rel = REL_RE.exec(t);
  if (rel) {
    const n = Number(rel[2]);
    return {
      kind: 'relativeDate',
      amount: n === 0 ? 0 : rel[1] === '-' ? -n : n,
      unit: (rel[3] ?? 'd').toLowerCase() as 'd' | 'w' | 'm' | 'y',
    };
  }
  const dur = DUR_RE.exec(t);
  if (dur) {
    const n = Number(dur[2]);
    return {
      kind: 'relativeDate',
      amount: n === 0 ? 0 : dur[1] === '-' ? -n : n,
      unit: (dur[3] ?? 'd').toLowerCase() as 'd' | 'w' | 'm' | 'y',
    };
  }
  throw dslError(
    input,
    raw.pos,
    `Invalid date '${t}' for field '${field}' (use 2026-01-31, an ISO timestamp, or a relative value like -2w, +3d, -P2W)`,
  );
}

function isMe(raw: RawScalar): boolean {
  return !raw.quoted && raw.text.toLowerCase() === 'me';
}
function isEmpty(raw: RawScalar): boolean {
  return !raw.quoted && raw.text.toLowerCase() === 'empty';
}

/** Coerce and validate one raw value for `field` (operator-independent). */
export function coerceScalar(input: string, field: FilterField, raw: RawScalar): FilterScalar {
  const spec = FILTER_FIELD_SPECS[field];
  const allows = (k: FilterValueKind): boolean => spec.values.includes(k);

  if (allows('me') && isMe(raw)) return { kind: 'me' };
  if (allows('empty') && isEmpty(raw)) return { kind: 'empty' };

  switch (field) {
    case 'statusCategory': {
      const v = raw.text.toLowerCase();
      if ((STATUS_CATEGORIES as readonly string[]).includes(v)) return { kind: 'string', value: v };
      throw dslError(input, raw.pos, `Invalid status category '${raw.text}' (expected one of: ${STATUS_CATEGORIES.join(', ')})`);
    }
    case 'priority': {
      const t = raw.text.toLowerCase();
      if (/^\d+$/.test(t)) {
        const n = Number(t);
        if (n >= 0 && n <= 4) return { kind: 'number', value: n };
        throw dslError(input, raw.pos, `Priority must be between 0 and 4, got '${raw.text}'`);
      }
      const alias = PRIORITY_ALIASES[t];
      if (alias !== undefined && Object.prototype.hasOwnProperty.call(PRIORITY_ALIASES, t)) {
        return { kind: 'number', value: alias };
      }
      throw dslError(input, raw.pos, `Invalid priority '${raw.text}' (expected 0-4 or urgent, high, medium, low, none)`);
    }
    case 'estimate': {
      if (/^\d+$/.test(raw.text)) {
        const n = Number(raw.text);
        if (n <= 40) return { kind: 'number', value: n };
        throw dslError(input, raw.pos, `Estimate must be an integer between 0 and 40, got '${raw.text}'`);
      }
      throw dslError(input, raw.pos, `Invalid estimate '${raw.text}' (expected an integer 0-40 or 'empty')`);
    }
    case 'createdAt':
    case 'updatedAt':
    case 'completedAt':
      return coerceDate(input, raw, field);
    case 'identifier': {
      if (!IDENTIFIER_RE.test(raw.text)) {
        throw dslError(input, raw.pos, `Invalid identifier '${raw.text}' (expected e.g. ENG-123)`);
      }
      return { kind: 'string', value: raw.text.toUpperCase() };
    }
    case 'relations': {
      const found = RELATION_FILTER_VALUES.find((v) => v.toLowerCase() === raw.text.toLowerCase());
      if (found) return { kind: 'string', value: found };
      throw dslError(input, raw.pos, `Invalid relation '${raw.text}' (expected one of: ${RELATION_FILTER_VALUES.join(', ')}, empty)`);
    }
    default:
      return { kind: 'string', value: raw.text };
  }
}
