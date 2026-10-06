// Copies the codegen-persisted operation manifest from the web app into the shared
// @velocity/graphql package, where the server reads it to resolve operation hashes.
// Run after `graphql-codegen` (apps/web `codegen` and `build` scripts do this).
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../src/gql/persisted-documents.json');
const target = resolve(here, '../../../packages/graphql/persisted-documents.json');

if (!existsSync(source)) {
  throw new Error(`Missing generated manifest: ${source}. Run graphql-codegen first.`);
}
copyFileSync(source, target);
console.log(`synced persisted manifest -> ${target}`);
