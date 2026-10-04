import type { FilterComparison, FilterField, FilterNode, FilterOp, FilterValue } from '@velocity/schema/filter-ast';

export type FilterChip = { field: FilterField; op: FilterOp; value: FilterValue; negated: boolean };

function toChip(node: FilterNode): FilterChip | null {
  if (node.type === 'cmp') return { field: node.field, op: node.op, value: node.value, negated: false };
  if (node.type === 'not' && node.child.type === 'cmp') {
    const c = node.child;
    return { field: c.field, op: c.op, value: c.value, negated: true };
  }
  return null;
}

/**
 * Convert an AST to chips. Returns `null` when the tree is not a top-level AND of
 * comparisons / negated comparisons (e.g. it contains `or`, nested `not` or groups).
 * A `null` filter yields an empty chip list.
 */
export function toChips(node: FilterNode | null): FilterChip[] | null {
  if (node === null) return [];
  if (node.type === 'and') {
    const chips: FilterChip[] = [];
    for (const child of node.children) {
      const chip = toChip(child);
      if (!chip) return null;
      chips.push(chip);
    }
    return chips;
  }
  const chip = toChip(node);
  return chip ? [chip] : null;
}

/** Build an AST from chips (AND of comparisons). No chips yields `null`. */
export function fromChips(chips: FilterChip[]): FilterNode | null {
  const nodes: FilterNode[] = chips.map((c) => {
    const cmp: FilterComparison = { type: 'cmp', field: c.field, op: c.op, value: c.value };
    return c.negated ? { type: 'not', child: cmp } : cmp;
  });
  if (nodes.length === 0) return null;
  if (nodes.length === 1) return nodes[0] as FilterNode;
  return { type: 'and', children: nodes };
}
