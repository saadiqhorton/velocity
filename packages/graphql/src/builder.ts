import SchemaBuilder from '@pothos/core';
import { GraphQLError, Kind } from 'graphql';
import type { GqlContext } from './context';

export interface JsonValue {
  [key: string]: unknown;
}

export const builder = new SchemaBuilder<{
  Context: GqlContext;
  DefaultFieldNullability: false;
  DefaultInputFieldRequiredness: false;
  Scalars: {
    ID: { Input: string; Output: string };
    DateTime: { Input: Date; Output: Date | string };
    Date: { Input: string; Output: string };
    JSON: { Input: unknown; Output: unknown };
    File: { Input: File; Output: never };
  };
}>({
  defaultFieldNullability: false,
});

builder.scalarType('DateTime', {
  description: 'ISO-8601 timestamp (UTC).',
  serialize: (v) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString()),
  parseValue: (v) => {
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) throw new GraphQLError('Invalid DateTime', { extensions: { code: 'VALIDATION' } });
    return d;
  },
  parseLiteral: (ast) => {
    if (ast.kind !== Kind.STRING) throw new GraphQLError('DateTime must be a string', { extensions: { code: 'VALIDATION' } });
    return new Date(ast.value);
  },
});

builder.scalarType('Date', {
  description: 'Calendar date, YYYY-MM-DD.',
  serialize: (v) => String(v),
  parseValue: (v) => {
    const s = String(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new GraphQLError('Date must be YYYY-MM-DD', { extensions: { code: 'VALIDATION' } });
    return s;
  },
});

builder.scalarType('JSON', {
  description: 'Arbitrary JSON value.',
  serialize: (v) => v,
  parseValue: (v) => v,
  parseLiteral: function parse(ast): unknown {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
      case Kind.FLOAT:
        return Number(ast.value);
      case Kind.NULL:
        return null;
      case Kind.LIST:
        return ast.values.map((v) => parse(v));
      case Kind.OBJECT:
        return Object.fromEntries(ast.fields.map((f) => [f.name.value, parse(f.value)]));
      default:
        return null;
    }
  },
});

builder.scalarType('File', {
  description: 'A file upload (GraphQL multipart request spec).',
  serialize: () => {
    throw new GraphQLError('File is input-only');
  },
  parseValue: (v) => v as File,
});

builder.queryType({});
builder.mutationType({});
builder.subscriptionType({});
