#!/usr/bin/env node
// Fails (exit 1) if a hex color literal appears in source under apps/ or
// packages/ outside packages/tokens/ (SPEC 4.2, 4.17 #5, 8.2).
//
// Scanned: .ts .tsx .js .jsx .mjs .cjs .css .html
// Ignored: node_modules, dist, coverage, .turbo, generated codegen output
//   (apps/web/src/gql/, any generated/ dir), packages/importers/fixtures/,
//   packages/tokens/, and every other extension (incl. .md).
//
// Heuristic (keeps false positives near zero). A candidate is `#` followed by
// 3, 4, 6 or 8 hex digits that end at a non-identifier character. It is
// rejected when:
//   - the previous char is a word char, `&` or `/`  (`.foo#bar`, `&#x27;`,
//     `&#123;`, `http://x/#abc`)
//   - it directly follows href=/to=/id=/for=/src=/name=/aria-*=/data-*= or
//     `url(`  (in-page anchors and SVG references: `href="#main"`)
//   - it is followed by `.`, `:`, `[`, `>` or by optional space + `{` (CSS id
//     selectors: `#abc { }`, `#abc.active`)
// Then:
//   - contains an a-f letter (`#fff`, `#1a2b3c`, `#ABCDEF`)  -> flagged
//   - 6 or 8 digits only (`#112233`)                          -> flagged
//   - 3 or 4 digits only (`#123`, `#1234`)                    -> flagged ONLY
//     in a color context: after `prop:`, or on a line where color/fill/stroke/
//     background/border/shadow/outline/gradient/rgb/hsl precedes it. This keeps
//     issue references like `#123` and `fixes #1234` from being flagged.
// Known blind spot: a bare digits-only color string such as `const c = '#000'`.
// Per-line escape hatch: add `check-hex-ignore` anywhere on the line.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', 'generated', 'playwright-report', 'test-results']);
// Playwright slot runs write `test-results_<slot>/` (and `playwright-report*`), all of which
// are gitignored build artifacts; skip them by prefix so their trace CSS is never scanned.
const SKIP_DIR_PREFIXES = ['test-results_', 'playwright-report_'];

/** True for generated/ignored dirs: exact SKIP_DIRS names plus Playwright slot output dirs. */
export function isSkippedDir(name) {
  return SKIP_DIRS.has(name) || SKIP_DIR_PREFIXES.some((p) => name.startsWith(p));
}
const SKIP_PREFIXES = ['packages/tokens/', 'apps/web/src/gql/', 'packages/importers/fixtures/'];

const CANDIDATE = /#([0-9a-fA-F]{3,8})(?![0-9A-Za-z_-])/g;
const ANCHOR_ATTR = /(?:\b(?:href|to|from|id|for|htmlFor|src|name)|\baria-[\w-]+|\bdata-[\w-]+|\bxlink:href)\s*=\s*\{?\s*["'`]?$|url\(\s*["']?$/;
const COLOR_CTX = /:\s*["'`]?$|\b(?:color|fill|stroke|background|bg|border|shadow|outline|gradient|rgba?|hsla?)\w*[^;\n]{0,40}$/i;

/** @returns {{line:number, col:number, text:string}[]} */
export function scanText(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (line.includes('check-hex-ignore')) return;
    CANDIDATE.lastIndex = 0;
    let m;
    while ((m = CANDIDATE.exec(line))) {
      const digits = m[1];
      if (![3, 4, 6, 8].includes(digits.length)) continue;
      const i = m.index;
      const prev = i > 0 ? line[i - 1] : '';
      if (prev && /[\w&/]/.test(prev)) continue;
      const before = line.slice(0, i);
      if (ANCHOR_ATTR.test(before)) continue;
      const after = line.slice(i + m[0].length);
      if (/^(?:[.:[>]|\s*\{)/.test(after)) continue;
      const hasLetter = /[a-fA-F]/.test(digits);
      const flagged = hasLetter || digits.length >= 6 || COLOR_CTX.test(before);
      if (flagged) hits.push({ line: idx + 1, col: i + 1, text: m[0] });
    }
  });
  return hits;
}

function* walk(dir, root) {
  for (const name of readdirSync(dir)) {
    if (isSkippedDir(name)) continue;
    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join('/');
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_PREFIXES.some((p) => `${rel}/`.startsWith(p))) continue;
      yield* walk(full, root);
    } else if (EXTS.has(name.slice(name.lastIndexOf('.')))) {
      yield rel;
    }
  }
}

export function run(root) {
  const findings = [];
  for (const top of ['apps', 'packages']) {
    try {
      statSync(join(root, top));
    } catch {
      continue;
    }
    for (const rel of walk(join(root, top), root)) {
      for (const h of scanText(readFileSync(join(root, rel), 'utf8'))) {
        findings.push(`${rel}:${h.line}:${h.col}  ${h.text}`);
      }
    }
  }
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const findings = run(root);
  if (findings.length > 0) {
    console.error('check-hex: hard-coded hex colors found (use ADS tokens from packages/tokens, SPEC 4.2):');
    for (const f of findings) console.error(`  ${f}`);
    console.error(`${findings.length} violation(s).`);
    process.exit(1);
  }
  console.log('check-hex: ok');
}
