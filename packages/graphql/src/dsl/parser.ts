import type {
  FilterComparison,
  FilterNode,
  FilterOp,
  FilterOrder,
  FilterQuery,
  FilterScalar,
  FilterValue,
  OrderField,
} from '@velocity/schema/filter-ast';
import { dslError } from './errors';
import {
  FILTER_FIELD_SPECS,
  IS_SHORTHANDS,
  coerceScalar,
  defaultDirection,
  resolveField,
  resolveOp,
  resolveOrderField,
} from './fields';
import type { RawScalar } from './fields';
import { tokenize } from './lexer';
import type { Token } from './lexer';

const MAX_DEPTH = 64;

class Parser {
  private readonly tokens: Token[];
  private idx = 0;
  private depth = 0;

  constructor(private readonly input: string) {
    this.tokens = tokenize(input);
  }

  private peek(offset = 0): Token {
    const t = this.tokens[Math.min(this.idx + offset, this.tokens.length - 1)];
    // tokenize always appends an eof token
    return t ?? { type: 'eof', text: '', start: this.input.length, end: this.input.length };
  }
  private next(): Token {
    const t = this.peek();
    if (t.type !== 'eof') this.idx++;
    return t;
  }

  private describe(t: Token): string {
    if (t.type === 'eof') return 'end of input';
    if (t.type === 'string') return `string "${t.text}"`;
    return `'${t.text}'`;
  }

  private isKeyword(t: Token, kw: string): boolean {
    return t.type === 'word' && t.text.toLowerCase() === kw;
  }

  private isOrderStart(offset = 0): boolean {
    const t = this.peek(offset);
    const c = this.peek(offset + 1);
    return this.isKeyword(t, 'order') && c.type === 'colon' && c.start === t.end;
  }

  parseQuery(): FilterQuery {
    let filter: FilterNode | null = null;
    if (!(this.peek().type === 'eof' || this.isOrderStart())) {
      filter = this.parseOr();
    }
    let order: FilterOrder[] = [];
    if (this.isOrderStart()) {
      order = this.parseOrder();
    }
    const t = this.peek();
    if (t.type !== 'eof') {
      if (t.type === 'rparen') throw dslError(this.input, t.start, "Unmatched ')'");
      throw dslError(this.input, t.start, `Unexpected ${this.describe(t)}`);
    }
    return { filter, order };
  }

  private parseOr(): FilterNode {
    const children: FilterNode[] = [this.parseAnd()];
    while (this.isKeyword(this.peek(), 'or')) {
      this.next();
      children.push(this.parseAnd());
    }
    return combine('or', children);
  }

  private atAndEnd(): boolean {
    const t = this.peek();
    return t.type === 'eof' || t.type === 'rparen' || this.isKeyword(t, 'or') || this.isOrderStart();
  }

  private parseAnd(): FilterNode {
    const children: FilterNode[] = [this.parseUnary()];
    for (;;) {
      if (this.atAndEnd()) break;
      if (this.isKeyword(this.peek(), 'and')) this.next();
      children.push(this.parseUnary());
    }
    return combine('and', children);
  }

  private enter(pos: number): void {
    if (++this.depth > MAX_DEPTH) {
      throw dslError(this.input, pos, `Expression is nested too deeply (max ${MAX_DEPTH})`);
    }
  }

  private parseUnary(): FilterNode {
    const t = this.peek();
    if (this.isKeyword(t, 'not')) {
      this.next();
      this.enter(t.start);
      const child = this.parseUnary();
      this.depth--;
      return { type: 'not', child };
    }
    if (t.type === 'lparen') {
      this.next();
      this.enter(t.start);
      if (this.peek().type === 'rparen') {
        throw dslError(this.input, this.peek().start, 'Empty parentheses');
      }
      const inner = this.parseOr();
      const close = this.peek();
      if (close.type !== 'rparen') {
        throw dslError(
          this.input,
          close.start,
          close.type === 'eof' ? "Missing closing ')'" : `Expected ')' but found ${this.describe(close)}`,
        );
      }
      this.next();
      this.depth--;
      return inner;
    }
    if (t.type === 'word') {
      if (this.isOrderStart()) {
        throw dslError(this.input, t.start, "The 'order:' clause must be last and cannot be nested");
      }
      if (this.isKeyword(t, 'and') || this.isKeyword(t, 'or')) {
        throw dslError(this.input, t.start, `Expected a filter expression but found '${t.text}'`);
      }
      return this.parseComparison();
    }
    throw dslError(this.input, t.start, `Expected a filter expression but found ${this.describe(t)}`);
  }

  private parseComparison(): FilterNode {
    const nameTok = this.next();
    const lower = nameTok.text.toLowerCase();

    // is: shorthand
    if (lower === 'is') {
      const c = this.peek();
      if (c.type === 'colon' && c.start === nameTok.end) {
        this.next();
        const v = this.peek();
        if ((v.type !== 'word' && v.type !== 'string') || v.start !== c.end) {
          throw dslError(this.input, c.end, "Expected a value after 'is:'");
        }
        this.next();
        const mapped = Object.prototype.hasOwnProperty.call(IS_SHORTHANDS, v.text.toLowerCase())
          ? IS_SHORTHANDS[v.text.toLowerCase()]
          : undefined;
        if (!mapped) {
          throw dslError(
            this.input,
            v.start,
            `Unknown 'is:' value '${v.text}' (expected one of: ${Object.keys(IS_SHORTHANDS).join(', ')})`,
          );
        }
        this.assertValueEnd(v);
        return { type: 'cmp', field: 'relations', op: 'eq', value: { kind: 'string', value: mapped } };
      }
    }

    const field = resolveField(nameTok.text);
    if (!field) throw dslError(this.input, nameTok.start, `Unknown field '${nameTok.text}'`);
    const spec = FILTER_FIELD_SPECS[field];

    // operator
    let op: FilterOp = 'eq';
    let opTok: Token = nameTok;
    const t1 = this.peek();
    if (t1.type === 'colon' && t1.start === nameTok.end) {
      // default op
    } else if (t1.type === 'word' && this.peek(1).type === 'colon' && this.peek(1).start === t1.end) {
      const resolved = resolveOp(t1.text);
      if (!resolved) {
        throw dslError(this.input, t1.start, `Unknown operator '${t1.text}' for field '${field}'`);
      }
      op = resolved;
      opTok = t1;
      this.next();
    } else {
      throw dslError(
        this.input,
        t1.start,
        `Expected ':' after field '${nameTok.text}' but found ${this.describe(t1)}`,
      );
    }
    if (!spec.ops.includes(op)) {
      throw dslError(
        this.input,
        opTok.start,
        `Operator '${op}' is not supported for field '${field}' (allowed: ${spec.ops.join(', ')})`,
      );
    }
    const colon = this.next(); // the colon

    // values
    const raws: RawScalar[] = [];
    let isList = false;
    let prev: Token = colon;
    for (;;) {
      const v = this.peek();
      if ((v.type !== 'word' && v.type !== 'string') || v.start !== prev.end) {
        const what = prev.type === 'comma' ? "','" : `':'`;
        throw dslError(this.input, prev.end, `Expected a value after ${what}`);
      }
      this.next();
      raws.push({ text: v.text, quoted: v.type === 'string', pos: v.start });
      prev = v;
      const c = this.peek();
      if (c.type === 'comma') {
        if (c.start !== v.end) {
          throw dslError(this.input, c.start, 'List values must be separated by commas without spaces');
        }
        this.next();
        isList = true;
        prev = c;
        continue;
      }
      break;
    }
    this.assertValueEnd(prev);

    const isSetOp = op === 'in' || op === 'nin';
    const first = raws[0];
    if (!first) throw dslError(this.input, colon.end, 'Expected a value');
    if (isList && !isSetOp) {
      throw dslError(this.input, first.pos, `Operator '${op}' does not accept a list of values`);
    }
    const scalars: FilterScalar[] = raws.map((r) => coerceScalar(this.input, field, r));
    this.checkOpValue(field, op, scalars, first.pos);
    let value: FilterValue;
    if (isSetOp) value = { kind: 'list', values: scalars };
    else value = scalars[0] as FilterScalar;
    const cmp: FilterComparison = { type: 'cmp', field, op, value };
    return cmp;
  }

  /** Reject a value immediately followed (no whitespace) by another word/string/paren. */
  private assertValueEnd(last: Token): void {
    const n = this.peek();
    if (n.start === last.end && (n.type === 'word' || n.type === 'string' || n.type === 'lparen')) {
      throw dslError(this.input, n.start, `Unexpected ${this.describe(n)}; separate terms with whitespace`);
    }
  }

  private checkOpValue(field: FilterComparison['field'], op: FilterOp, scalars: FilterScalar[], pos: number): void {
    if (field === 'completedAt' && op === 'neq') {
      if (!scalars.every((s) => s.kind === 'empty')) {
        throw dslError(this.input, pos, "Operator 'neq' on 'completedAt' only accepts 'empty'");
      }
    }
    if (field === 'completedAt' && scalars.some((s) => s.kind === 'empty') && op !== 'eq' && op !== 'neq') {
      throw dslError(this.input, pos, `'empty' cannot be used with operator '${op}'`);
    }
    if (field === 'estimate' || field === 'priority') {
      const emptyBad = scalars.some((s) => s.kind === 'empty') && ['gt', 'gte', 'lt', 'lte'].includes(op);
      if (emptyBad) throw dslError(this.input, pos, `'empty' cannot be used with operator '${op}'`);
    }
  }

  private parseOrder(): FilterOrder[] {
    this.next(); // order
    this.next(); // colon
    const terms: FilterOrder[] = [];
    const seen = new Set<OrderField>();
    for (;;) {
      const f = this.peek();
      if (f.type !== 'word') {
        throw dslError(this.input, f.start, `Expected an order field but found ${this.describe(f)}`);
      }
      const field = resolveOrderField(f.text);
      if (!field) throw dslError(this.input, f.start, `Unknown order field '${f.text}'`);
      if (seen.has(field)) throw dslError(this.input, f.start, `Duplicate order field '${field}'`);
      seen.add(field);
      this.next();
      let direction: 'asc' | 'desc' = defaultDirection(field);
      const d = this.peek();
      if (d.type === 'colon' && d.start === f.end) {
        this.next();
        const dv = this.peek();
        const dir = dv.type === 'word' && dv.start === d.end ? dv.text.toLowerCase() : '';
        if (dir !== 'asc' && dir !== 'desc') {
          throw dslError(this.input, d.end, "Expected 'asc' or 'desc' after ':'");
        }
        this.next();
        direction = dir;
      } else if (d.type === 'word' && (d.text.toLowerCase() === 'asc' || d.text.toLowerCase() === 'desc')) {
        this.next();
        direction = d.text.toLowerCase() as 'asc' | 'desc';
      }
      terms.push({ field, direction });
      if (this.peek().type === 'comma') {
        this.next();
        continue;
      }
      break;
    }
    const rest = this.peek();
    if (rest.type !== 'eof' && rest.type !== 'rparen') {
      throw dslError(
        this.input,
        rest.start,
        `Unexpected ${this.describe(rest)} after order clause (the order clause must be last; expected ',' or end of input)`,
      );
    }
    return terms;
  }
}

function combine(type: 'and' | 'or', children: FilterNode[]): FilterNode {
  if (children.length === 1) return children[0] as FilterNode;
  const flat: FilterNode[] = [];
  for (const c of children) {
    if (c.type === type) flat.push(...c.children);
    else flat.push(c);
  }
  return { type, children: flat };
}

/** Parse a filter DSL string. Throws `DslError` on malformed input. */
export function parseFilter(input: string): FilterQuery {
  return new Parser(input).parseQuery();
}
