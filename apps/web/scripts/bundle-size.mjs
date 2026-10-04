#!/usr/bin/env node
// Initial-JS budget check (SPEC §4.16: ≤ 350 KB gzip). Sums the gzip size of every script
// the built index.html loads up front (entry module + modulepreloads).
// Usage: node scripts/bundle-size.mjs [distDir] [--budget=350]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dist = resolve(args.find((a) => !a.startsWith('--')) ?? fileURLToPath(new URL('../dist', import.meta.url)));
const budgetKb = Number(args.find((a) => a.startsWith('--budget='))?.slice(9) ?? 350);

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const urls = new Set();
for (const m of html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)) urls.add(m[1]);
for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) urls.add(m[1]);

let total = 0;
const rows = [];
for (const url of urls) {
  const file = join(dist, url.replace(/^\//, ''));
  const gz = gzipSync(readFileSync(file), { level: 9 }).length;
  total += gz;
  rows.push([url, gz]);
}
rows.sort((a, b) => b[1] - a[1]);
for (const [url, gz] of rows) console.log(`${(gz / 1024).toFixed(1).padStart(7)} KB  ${url}`);
const kb = total / 1024;
console.log(`initial JS: ${kb.toFixed(1)} KB gzip (budget ${budgetKb} KB)`);
if (kb > budgetKb) {
  console.error('over budget');
  process.exit(1);
}
