import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { boot } from './helpers';
import type { RunningApp } from './helpers';
import { findMcpClient } from '../src/http/mcp-client';

let running: RunningApp | undefined;
afterEach(async () => { await running?.close(); running = undefined; });

/** Names and contents of regular files in a ustar archive. */
export function untar(tar: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (let off = 0; off + 512 <= tar.length && tar[off] !== 0; ) {
    const name = tar.subarray(off, off + 100).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(tar.subarray(off + 124, off + 136).toString('ascii').replace(/\0.*$/, ''), 8);
    files.set(name, tar.subarray(off + 512, off + 512 + size));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

it('serves the content-addressed stdio client tarball without auth', async () => {
  const client = findMcpClient(new URL('../src/config.ts', import.meta.url).href);
  expect(client, 'apps/mcp must be built (turbo does this before tests)').not.toBeNull();
  running = await boot();
  const res = await fetch(`${running.base}/mcp/client-${client!.hash}.tgz`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/gzip');
  expect(res.headers.get('cache-control')).toContain('immutable');
  const files = untar(gunzipSync(Buffer.from(await res.arrayBuffer())));
  const pkg = JSON.parse(files.get('package/package.json')!.toString('utf8')) as { version: string; bin: Record<string, string>; dependencies?: unknown };
  expect(client!.hash).toBe(createHash('sha256').update(readFileSync(client!.file)).digest('hex').slice(0, 12));
  expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(pkg.bin['velocity-mcp']).toBe('./index.js');
  expect(pkg.dependencies).toBeUndefined();
  expect(files.get('package/index.js')!.toString('utf8').startsWith('#!/usr/bin/env node')).toBe(true);
});

it('404s for any other name', async () => {
  running = await boot();
  for (const v of ['1.0.0', '000000000000', '..%2Fx']) expect((await fetch(`${running.base}/mcp/client-${v}.tgz`)).status).toBe(404);
});

it('rebuilding the client twice yields the same content hash and bytes', () => {
  const mcpDir = new URL('../../mcp', import.meta.url).pathname;
  const build = () => {
    const out = mkdtempSync(join(tmpdir(), 'velocity-mcp-repro-'));
    execFileSync(process.execPath, ['build.mjs'], { cwd: mcpDir, env: { ...process.env, MCP_CLIENT_OUT: out }, stdio: 'ignore' });
    const [name] = readdirSync(out).filter((f) => f.endsWith('.tgz'));
    return { name: name!, bytes: readFileSync(join(out, name!)) };
  };
  const a = build();
  const b = build();
  expect(a.name).toMatch(/^client-[0-9a-f]{12}\.tgz$/);
  expect(b.name).toBe(a.name);
  expect(b.bytes.equals(a.bytes)).toBe(true);
}, 60_000);
