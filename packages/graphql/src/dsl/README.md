# Filter DSL

Pure parser/serializer for the Velocity issue filter language (SPEC §6.1.4). No runtime
dependencies; safe to bundle into the browser. The AST contract lives in
`@velocity/schema/filter-ast`.

```ts
import { parseFilter, serializeFilter, toChips, fromChips, FILTER_FIELD_SPECS, DslError } from '@velocity/graphql/dsl';

const q = parseFilter('assignee:me and priority lt:2 and not label:bug order:priority asc');
serializeFilter(q); // canonical text; parseFilter(serializeFilter(q)) deep-equals q
```

Errors are thrown as `DslError`; `err.info` is `{ message, position, caret }` where `position`
is a 0-based offset and `caret` is the input, a newline, then spaces and `^` under `position`.

## Grammar (EBNF)

```
query        = [ expr ] [ orderClause ] ;
expr         = orExpr ;
orExpr       = andExpr { "or" andExpr } ;
andExpr      = unary { [ "and" ] unary } ;          (* juxtaposition = AND *)
unary        = "not" unary | "(" expr ")" | comparison ;
comparison   = isShorthand | field [ op ] ":" value ;   (* no space before ":" or after it *)
isShorthand  = "is" ":" ( "blocked" | "blocking" | "duplicate" | "related" ) ;
op           = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "nin"
             | "contains" | "startsWith" | "endsWith" ;
value        = scalar { "," scalar } ;                 (* lists: no spaces around "," *)
scalar       = bareWord | quoted ;
bareWord     = ( letter | digit | "_" | "-" | "." | "@" | "/" | "+" ) { same } ;
               (* an ISO timestamp may also contain ":" *)
quoted       = '"' { char | '\"' | '\\' } '"' ;
orderClause  = "order" ":" orderTerm { "," orderTerm } ;   (* must be last, top level *)
orderTerm    = orderField [ ( "asc" | "desc" ) | ":" ( "asc" | "desc" ) ] ;
```

Keywords (`and`, `or`, `not`, `order`, `is`), operator names and field names are case-insensitive
and normalized to canonical casing. Whitespace (including newlines) separates tokens.
Precedence: `not` > `and` > `or`. Nesting deeper than 64 levels is rejected.

## Fields

| Field | Ops | Values |
|---|---|---|
| team, status | eq neq in nin | string |
| project, label | eq neq in nin | string, `empty` |
| statusCategory | eq neq in nin | backlog, todo, in_progress, done, canceled |
| assignee, creator | eq neq in nin | `me`, `empty`, string (username or uuid) |
| priority | eq neq gt gte lt lte in nin | 0-4 or urgent/high/medium/low/none/no_priority (-> number) |
| cycle | eq neq in nin | string (`current`, `next`, `previous`, number, name, uuid), `empty` |
| estimate | eq neq gt gte lt lte in nin | integer 0-40, `empty` |
| createdAt, updatedAt | eq gt gte lt lte | date, relative date |
| completedAt | eq neq gt gte lt lte | date, relative date, `empty` (`neq` only with `empty`) |
| title, description | eq neq contains startsWith endsWith | string |
| identifier | eq in | `ENG-123` (team key upper-cased) |
| parent | eq neq | `empty`, identifier or uuid |
| relations | eq neq | blocks, blockedBy, related, duplicate, `empty` |

Aliases: `created`, `updated`, `completed` for `createdAt`, `updatedAt`, `completedAt`
(in filters and order terms). `in`/`nin` take a list (a single value becomes a 1-item list);
all other ops reject lists.

## Values

- Bare `me` / `empty` (any case) become `{kind:'me'}` / `{kind:'empty'}` on fields that accept them;
  quoted `"me"` is always a string.
- Dates: `2026-01-31`, `2026-01-31T10:00:00Z` -> `{kind:'date'}`.
- Relative: `-2w`, `-7d`, `-1m`, `-1y`, `+3d`, or ISO-duration style `-P2W`, `P3D`
  -> `{kind:'relativeDate', amount, unit}` (amount signed; units d w m y).
- `is:blocked` -> `relations:blockedBy`, `is:blocking` -> `relations:blocks`,
  `is:duplicate` -> `relations:duplicate`, `is:related` -> `relations:related` (desugared at parse time).

## Order

`order:priority asc, createdAt desc` or `order:priority:asc`. Fields: priority, status, createdAt,
updatedAt, completedAt, estimate, manual, title, identifier. Default direction is `desc` for
createdAt/updatedAt/completedAt and `asc` otherwise. An input with only an order clause is valid;
empty input is `{ filter: null, order: [] }`.

## Examples

```
assignee:me and statusCategory:in_progress and priority lt:2 and not label:bug order:priority asc
priority in:0,1,2 label:empty
status in:"In Progress",Todo createdAt gt:-2w
title contains:"login bug" or identifier:eng-12
(team:ENG or team:WEB) and not is:blocked order:created
```

## Chips

`toChips(node)` returns `FilterChip[]` for a top-level AND of comparisons / negated comparisons
(`[]` for a null filter) and `null` when the tree needs the DSL (contains `or`, grouped `not`, ...).
`fromChips(chips)` builds the AND tree (`null` for no chips). `FILTER_FIELD_SPECS` describes the
allowed ops/value kinds per field for the chip UI.
