import type { FilterNode, FilterOrder, FilterQuery, FilterScalar, FilterValue } from '@velocity/schema/filter-ast';
import { BARE_WORD_RE } from './lexer';

function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function serializeString(s: string): string {
  const lower = s.toLowerCase();
  if (BARE_WORD_RE.test(s) && lower !== 'me' && lower !== 'empty') return s;
  return quote(s);
}

export function serializeScalar(v: FilterScalar): string {
  switch (v.kind) {
    case 'me':
      return 'me';
    case 'empty':
      return 'empty';
    case 'string':
      return serializeString(v.value);
    case 'number':
      return String(v.value);
    case 'date':
      return v.value;
    case 'relativeDate':
      return `${v.amount < 0 ? '-' : '+'}${Math.abs(v.amount)}${v.unit}`;
  }
}

export function serializeValue(v: FilterValue): string {
  if (v.kind === 'list') return v.values.map(serializeScalar).join(',');
  return serializeScalar(v);
}

function serializeNode(node: FilterNode, parent: 'root' | 'and' | 'or' | 'not'): string {
  switch (node.type) {
    case 'cmp': {
      const head = node.op === 'eq' ? node.field : `${node.field} ${node.op}`;
      return `${head}:${serializeValue(node.value)}`;
    }
    case 'not':
      return `not ${serializeNode(node.child, 'not')}`;
    case 'and': {
      const s = node.children.map((c) => serializeNode(c, 'and')).join(' and ');
      return parent === 'not' || parent === 'and' ? `(${s})` : s;
    }
    case 'or': {
      const s = node.children.map((c) => serializeNode(c, 'or')).join(' or ');
      return parent === 'root' ? s : `(${s})`;
    }
  }
}

export function serializeOrder(order: FilterOrder[]): string {
  return `order:${order.map((o) => `${o.field} ${o.direction}`).join(', ')}`;
}

/** Canonical string form of a query. */
export function serializeFilter(q: FilterQuery): string {
  const parts: string[] = [];
  if (q.filter) parts.push(serializeNode(q.filter, 'root'));
  if (q.order.length > 0) parts.push(serializeOrder(q.order));
  return parts.join(' ');
}
