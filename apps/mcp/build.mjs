// Builds the stdio client into one self-contained file (every dependency inlined) and packs it
// into an npm-installable tarball, `dist/client-<hash>.tgz`, without needing npm. The Velocity
// server ships and serves that tarball at /mcp/client-<hash>.tgz (`npx -y <url>` runs the bin).
import { build } from 'esbuild';
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

// MCP_CLIENT_OUT redirects the output (the reproducibility test builds into temp dirs).
const outDir = process.env.MCP_CLIENT_OUT ?? 'dist';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith('.tgz')) rmSync(`${outDir}/${f}`);
await build({
  entryPoints: ['src/index.ts'],
  outfile: `${outDir}/index.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __velocityCreateRequire } from 'node:module'; const require = __velocityCreateRequire(import.meta.url);",
  },
  sourcemap: false,
  logLevel: 'info',
});
chmodSync(`${outDir}/index.js`, 0o755);

/** Minimal ustar writer: enough for an npm tarball (regular files under `package/`). */
function tarEntry(name, data, mode) {
  const header = Buffer.alloc(512);
  const put = (value, offset, length) => header.write(value, offset, length, 'ascii');
  put(name, 0, 100);
  put(mode.toString(8).padStart(7, '0'), 100, 8);
  put('0000000', 108, 8);
  put('0000000', 116, 8);
  put(data.length.toString(8).padStart(11, '0'), 124, 12);
  put('00000000000', 136, 12); // fixed mtime: reproducible output
  put('        ', 148, 8); // checksum placeholder (spaces)
  put('0', 156, 1);
  put('ustar', 257, 6);
  put('00', 263, 2);
  let sum = 0;
  for (const b of header) sum += b;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, pad]);
}

const manifest = {
  name: 'velocity-mcp',
  version: pkg.version,
  description: pkg.description,
  license: pkg.license,
  type: 'module',
  bin: { 'velocity-mcp': './index.js' },
  engines: { node: '>=22' },
};
const tar = Buffer.concat([
  tarEntry('package/package.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), 0o644),
  tarEntry('package/index.js', readFileSync(`${outDir}/index.js`), 0o755),
  Buffer.alloc(1024),
]);
// gzip header mtime is zeroed by zlib's default (0), so the archive is reproducible. The file is
// named by content hash, so a changed client always gets a new URL (npx never serves a stale one).
const gz = gzipSync(tar, { level: 9 });
const out = `${outDir}/client-${createHash('sha256').update(gz).digest('hex').slice(0, 12)}.tgz`;
writeFileSync(out, gz);
console.log(`packed ${out} (${tar.length} bytes uncompressed)`);
