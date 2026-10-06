import type { CodegenConfig } from '@graphql-codegen/cli';
import { addTypenameSelectionDocumentTransform } from '@graphql-codegen/client-preset';

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
      // The server ships this generated map with the image. Browser operations send its
      // hash while the public API continues to accept ordinary GraphQL documents.
      presetConfig: { fragmentMasking: false, persistedDocuments: true },
      // The server executes the manifest text, so it needs the same typename fields
      // Apollo would otherwise add to the browser's outgoing document for its cache.
      documentTransforms: [addTypenameSelectionDocumentTransform],
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
