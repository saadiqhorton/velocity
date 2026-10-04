import { GraphQLError, Kind } from 'graphql';
import type { ASTVisitor, FragmentDefinitionNode, SelectionSetNode, ValidationContext } from 'graphql';

/** Query depth limit (SPEC §7.1.4: depth ≤ 10). Fragments are expanded; introspection is exempt. */
export function depthLimitRule(maxDepth = 10) {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const def of context.getDocument().definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);
    }
    const depthOf = (set: SelectionSetNode | undefined, depth: number, seen: Set<string>): number => {
      if (!set) return depth;
      let max = depth;
      for (const sel of set.selections) {
        if (sel.kind === Kind.FIELD) {
          if (sel.name.value.startsWith('__')) continue;
          max = Math.max(max, depthOf(sel.selectionSet, depth + 1, seen));
        } else if (sel.kind === Kind.INLINE_FRAGMENT) {
          max = Math.max(max, depthOf(sel.selectionSet, depth, seen));
        } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
          const name = sel.name.value;
          if (seen.has(name)) continue;
          const frag = fragments.get(name);
          if (frag) max = Math.max(max, depthOf(frag.selectionSet, depth, new Set([...seen, name])));
        }
      }
      return max;
    };
    return {
      OperationDefinition(node) {
        const d = depthOf(node.selectionSet, 0, new Set());
        if (d > maxDepth) {
          context.reportError(new GraphQLError(`Query depth ${d} exceeds the limit of ${maxDepth}.`, { nodes: [node], extensions: { code: 'VALIDATION' } }));
        }
      },
    };
  };
}

/**
 * Complexity budget: every field costs 1; list-returning connections multiply their subtree
 * by the requested page size (`first`, default 50). Keeps a single request from fanning out
 * to millions of resolver calls.
 */
export function complexityLimitRule(maxCost = 50_000) {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const def of context.getDocument().definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);
    }
    const LIST_FIELDS = new Set(['issues', 'nodes', 'edges', 'children', 'comments', 'notifications', 'search', 'activity', 'projects', 'cycles', 'views', 'users', 'labels', 'teams', 'statuses', 'relations', 'milestones', 'subscribers', 'members']);
    const costOf = (set: SelectionSetNode | undefined, seen: Set<string>): number => {
      if (!set) return 0;
      let total = 0;
      for (const sel of set.selections) {
        if (sel.kind === Kind.FIELD) {
          if (sel.name.value.startsWith('__')) continue;
          let mult = 1;
          if (LIST_FIELDS.has(sel.name.value)) {
            const firstArg = sel.arguments?.find((a) => a.name.value === 'first' || a.name.value === 'limit');
            mult = firstArg && firstArg.value.kind === Kind.INT ? Math.max(1, Number(firstArg.value.value)) : 50;
            if (sel.name.value === 'nodes' || sel.name.value === 'edges') mult = 1; // counted on the connection field
          }
          total += 1 + mult * costOf(sel.selectionSet, seen);
        } else if (sel.kind === Kind.INLINE_FRAGMENT) {
          total += costOf(sel.selectionSet, seen);
        } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
          const name = sel.name.value;
          if (seen.has(name)) continue;
          const frag = fragments.get(name);
          if (frag) total += costOf(frag.selectionSet, new Set([...seen, name]));
        }
      }
      return total;
    };
    return {
      OperationDefinition(node) {
        const cost = costOf(node.selectionSet, new Set());
        if (cost > maxCost) {
          context.reportError(new GraphQLError(`Query complexity ${cost} exceeds the budget of ${maxCost}. Request fewer items per page.`, { nodes: [node], extensions: { code: 'VALIDATION' } }));
        }
      },
    };
  };
}
