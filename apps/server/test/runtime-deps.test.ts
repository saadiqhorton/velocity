import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packages = ['schema', 'events', 'services', 'graphql', 'mcp-tools', 'importers'];
const readPackage = (path: string): { dependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(`${root}/${path}/package.json`, 'utf8'));

describe('deployed server runtime dependencies', () => {
  it('links every external dependency in the bundled workspace graph', () => {
    const direct = readPackage('apps/server').dependencies ?? {};
    const missing = packages.flatMap((name) =>
      Object.keys(readPackage(`packages/${name}`).dependencies ?? {}).filter(
        (dependency) => !dependency.startsWith('@velocity/') && !direct[dependency],
      ),
    );
    expect(missing).toEqual([]);
  });
});
