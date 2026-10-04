import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * Typed documents for the web app (SPEC §5.4). Operations live in src/graphql/*.graphql;
 * import `XxxDocument` constants from `@/gql/graphql` (never the `graphql()` map, which
 * would bundle every document into one chunk).
 */
const config: CodegenConfig = {
  schema: '../../packages/graphql/schema.graphql',
  documents: ['src/graphql/**/*.graphql'],
  ignoreNoDocuments: false,
  generates: {
    './src/gql/': {
      preset: 'client',
      presetConfig: { fragmentMasking: false },
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        nonOptionalTypename: true,
        dedupeFragments: true,
        scalars: { ID: { input: 'string', output: 'string' }, DateTime: 'string', Date: 'string', JSON: 'unknown', File: 'File' },
      },
    },
  },
  hooks: {},
};

export default config;
