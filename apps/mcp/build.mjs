import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Bundle workspace code; the SDK and zod are runtime dependencies.
  external: ['@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*', 'zod', 'zod/*'],
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: false,
  logLevel: 'info',
});
chmodSync('dist/index.js', 0o755);
