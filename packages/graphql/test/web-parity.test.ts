import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { Kind, buildSchema, parse, specifiedRules, validate } from 'graphql/index.js';
import type { DefinitionNode, DocumentNode, FragmentDefinitionNode, OperationDefinitionNode } from 'graphql/index.js';
import { describe, expect, it } from 'vitest';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webSrc = resolve(packageDir, '../../apps/web/src');
const publicSchema = buildSchema(readFileSync(join(packageDir, 'schema.graphql'), 'utf8'));
const parityRules = specifiedRules.filter((rule) => rule.name !== 'NoUnusedFragmentsRule');

interface SourceDocument {
  source: string;
  document: DocumentNode;
}

function filesUnder(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    });
  } catch {
    return [];
  }
}

function literalValue(node: ts.Expression): unknown {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) {
    return literalValue(node.expression);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((element) => literalValue(element as ts.Expression));
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !property.name || ts.isComputedPropertyName(property.name)) continue;
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
        ? property.name.text
        : undefined;
      if (name !== undefined) result[name] = literalValue(property.initializer);
    }
    return result;
  }
  return undefined;
}

function generatedDocuments(source: string, fileName: string): SourceDocument[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const documents: SourceDocument[] = [];
  const addGraphqlSource = (text: string): void => {
    if (!/^\s*(?:query|mutation|subscription|fragment)\b/.test(text)) return;
    try {
      documents.push({ source: text, document: parse(text) });
    } catch {
      // Not a standalone document (e.g. a keyword string like "query" inside a
      // generated DocumentNode literal) — the object-literal path below handles it.
    }
  };
  // Locations are irrelevant for schema validation, and reconstructed literals
  // carry broken `loc` metadata (missing source bodies) that crashes graphql-js
  // validation. Strip `loc` from anything shaped like an AST node.
  const stripLoc = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripLoc);
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(record)) {
        if (key === 'loc' && typeof record.kind === 'string') continue;
        out[key] = stripLoc(entry);
      }
      return out;
    }
    return value;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) addGraphqlSource(node.text);
    if (ts.isObjectLiteralExpression(node)) {
      const value = literalValue(node) as { kind?: unknown; definitions?: unknown } | undefined;
      if (value?.kind === Kind.DOCUMENT && Array.isArray(value.definitions)) {
        documents.push({ source: node.getText(sourceFile), document: stripLoc(value) as unknown as DocumentNode });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return documents;
}

function parseSourceDocuments(source: string, file: string): SourceDocument[] {
  if (extname(file) === '.graphql') {
    return [{ source, document: parse(source) }];
  }
  return generatedDocuments(source, file);
}

type SelectionSet = OperationDefinitionNode['selectionSet'] | FragmentDefinitionNode['selectionSet'];

function reachableFragments(
  root: OperationDefinitionNode | FragmentDefinitionNode,
  fragments: Map<string, FragmentDefinitionNode>,
): FragmentDefinitionNode[] {
  const reached = new Map<string, FragmentDefinitionNode>();
  const visitSet = (selectionSet: SelectionSet, seen: Set<string>): void => {
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const name = selection.name.value;
        const fragment = fragments.get(name);
        if (!fragment || seen.has(name)) continue;
        reached.set(name, fragment);
        visitSet(fragment.selectionSet, new Set([...seen, name]));
      } else if (selection.kind === Kind.FIELD && selection.selectionSet) {
        visitSet(selection.selectionSet, seen);
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        visitSet(selection.selectionSet, seen);
      }
    }
  };
  visitSet(root.selectionSet, new Set());
  return [...reached.values()];
}

type ParsedDocument =
  | { file: string; source: string; document: DocumentNode }
  | { file: string; source: string; parseError: string };

function parityFailures(sources: { file: string; source: string }[]): string[] {
  const documents: ParsedDocument[] = sources.flatMap(({ file, source }): ParsedDocument[] => {
    try {
      return parseSourceDocuments(source, file).map((entry) => ({ file, ...entry }));
    } catch (error) {
      return [{ file, source, parseError: error instanceof Error ? error.message : String(error) }];
    }
  });
  const failures = documents.flatMap((doc) => ('parseError' in doc ? [`${doc.file}: ${doc.parseError}`] : []));
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const entry of documents) {
    if ('parseError' in entry) continue;
    for (const definition of entry.document.definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
    }
  }

  const operations: { file: string; operation: OperationDefinitionNode }[] = [];
  const standaloneFragments = new Map<string, { file: string; fragment: FragmentDefinitionNode }>();
  for (const entry of documents) {
    if ('parseError' in entry) continue;
    for (const definition of entry.document.definitions) {
      if (definition.kind === Kind.OPERATION_DEFINITION) operations.push({ file: entry.file, operation: definition });
      if (definition.kind === Kind.FRAGMENT_DEFINITION) standaloneFragments.set(definition.name.value, { file: entry.file, fragment: definition });
    }
  }

  const validateDefinitions = (file: string, definitions: DefinitionNode[]): void => {
    const errors = validate(publicSchema, { kind: Kind.DOCUMENT, definitions }, parityRules);
    failures.push(...errors.map((error) => `${file}: ${error.message}`));
  };
  const usedFragments = new Set<string>();
  for (const { file, operation } of operations) {
    const reachable = reachableFragments(operation, fragments);
    for (const fragment of reachable) usedFragments.add(fragment.name.value);
    validateDefinitions(file, [operation, ...reachable]);
  }
  // Fragments already validated through an operation are skipped here so each
  // drift is reported once, attributed to the operation that uses it.
  for (const { file, fragment } of standaloneFragments.values()) {
    if (usedFragments.has(fragment.name.value)) continue;
    validateDefinitions(file, [fragment, ...reachableFragments(fragment, fragments)]);
  }
  return failures;
}

describe('web/public GraphQL parity', () => {
  it('validates web .graphql docs and generated client documents against schema.graphql', () => {
    const candidates = filesUnder(webSrc).filter((file) => {
      const rel = file.slice(webSrc.length + 1);
      return extname(file) === '.graphql' || rel.startsWith(`gql${process.platform === 'win32' ? '\\' : '/'}`);
    });
    const sources = candidates.map((file) => ({ file, source: readFileSync(file, 'utf8') }));

    // The Web work package may not have created source documents yet on a backend-only checkout.
    if (sources.length === 0) return;
    expect(parityFailures(sources)).toEqual([]);
  });

  it('detects schema drift in raw .graphql documents', () => {
    const source = 'query MissingField { issue(id: "x") { fieldThatDoesNotExist } }';
    expect(parityFailures([{ file: 'fixture.graphql', source }])).toEqual([
      'fixture.graphql: Cannot query field "fieldThatDoesNotExist" on type "Issue".',
    ]);
  });

  it('detects schema drift in ordinary client-preset DocumentNode output', () => {
    const doc = parse('query MissingGeneratedField { issue(id: "x") { fieldThatDoesNotExist } }');
    const source = `export const MissingGeneratedFieldDocument = ${JSON.stringify(doc)} as unknown as DocumentNode;`;
    expect(parityFailures([{ file: 'gql/graphql.ts', source }])).toEqual([
      'gql/graphql.ts: Cannot query field "fieldThatDoesNotExist" on type "Issue".',
    ]);
  });

  it('extracts escaped operation strings from gql.ts document dictionaries', () => {
    const source = `export const documents = { ${JSON.stringify('query Drift { issue(id: "x") { removedField } }')}: {} };`;
    expect(parityFailures([{ file: 'gql/gql.ts', source }])).toEqual([
      'gql/gql.ts: Cannot query field "removedField" on type "Issue".',
    ]);
  });

  it('resolves fragments across independent source files', () => {
    expect(parityFailures([
      { file: 'issues.graphql', source: 'query Issues { issue(id: "x") { ...IssueFields } }' },
      { file: 'fragments.graphql', source: 'fragment IssueFields on Issue { fieldThatDoesNotExist }' },
    ])).toEqual(['issues.graphql: Cannot query field "fieldThatDoesNotExist" on type "Issue".']);
  });
});
