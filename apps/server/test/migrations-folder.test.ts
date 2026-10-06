import { describe, expect, it } from 'vitest';
import { migrationsFolderFor } from '../src/migrations-folder';

describe('migrationsFolderFor', () => {
  it('points every bundled entry (not only main.js) at dist/migrations', () => {
    for (const entry of ['main.js', 'seed-cli.js', 'migrate-cli.js', 'admin-cli.js']) {
      expect(migrationsFolderFor(`file:///app/dist/${entry}`)).toBe('/app/dist/migrations');
    }
  });
  it('defers to the schema package when running from source', () => {
    expect(migrationsFolderFor('file:///repo/apps/server/src/seed-cli.ts')).toBeUndefined();
  });
});
