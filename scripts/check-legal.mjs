#!/usr/bin/env node
// Legal / clean-room guard (SPEC 1.5, 8.2). Fails (exit 1) when:
//   1. LICENSE, NOTICE or BRANDING.md is missing.
//   2. Any package.json (root, apps/*, packages/*) lacks license AGPL-3.0-or-later.
//   3. A file under apps/ or packages/ references a Linear-owned asset host
//      (linear.app/static, cdn.linear.app, assets.linear.app). Exempt:
//      packages/importers/ (it legitimately imports from Linear and its
//      fixtures are real exports).
//   4. User-facing copy under apps/web/src contains the word "Linear".
//      Allowed: comment lines (//, /*, *, <!--, {/*) that use the sanctioned
//      phrases "Linear-style", "Linear-parity", "Linear parity",
//      "Linear-like" or "Linear's public API"; test/spec files; and the
//      import flow (any path containing "import"), where naming the source
//      product is nominative fair use (SPEC 1.5 #3).
// Per-line escape hatch: `check-legal-ignore` anywhere on the line.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FILES = ['LICENSE', 'NOTICE', 'BRANDING.md'];
const LICENSE_ID = 'AGPL-3.0-or-later';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', 'playwright-report', 'test-results']);
const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.json', '.md', '.mdx', '.svg', '.yml', '.yaml', '.txt', '.sql', '.graphql', '.gql']);
const ASSET_HOSTS = /linear\.app\/static|cdn\.linear\.app|assets\.linear\.app/i;
const LINEAR_WORD = /\bLinear\b/;
const ALLOWED_PHRASE = /Linear[- ](?:style|parity|like)\b|Linear's public API/;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|<!--|\{\s*\/\*|#)/;

/** @returns {string[]} problems found in one text file */
export function scanFile(rel, text) {
  const problems = [];
  const inImporters = rel.startsWith('packages/importers/');
  const inWebSrc = rel.startsWith('apps/web/src/');
  const exempt = /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(rel) || /(?:^|\/)import/i.test(rel);
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes('check-legal-ignore')) return;
    const where = `${rel}:${i + 1}`;
    if (!inImporters && ASSET_HOSTS.test(line)) {
      problems.push(`${where}  references a Linear-owned asset host`);
    }
    if (inWebSrc && !exempt && LINEAR_WORD.test(line)) {
      const sanctionedComment = COMMENT_LINE.test(line) && ALLOWED_PHRASE.test(line.replace(/[^]*?(?=Linear)/, ''));
      if (!sanctionedComment) problems.push(`${where}  the word "Linear" in apps/web source: ${line.trim().slice(0, 100)}`);
    }
  });
  return problems;
}

function* walk(dir, root) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full, root);
    else if (TEXT_EXTS.has(name.slice(name.lastIndexOf('.'))) && st.size < 5_000_000) {
      yield relative(root, full).split(sep).join('/');
    }
  }
}

export function run(root) {
  const problems = [];
  for (const f of REQUIRED_FILES) {
    if (!existsSync(join(root, f))) problems.push(`${f}  missing`);
  }

  const manifests = ['package.json'];
  for (const top of ['apps', 'packages']) {
    if (!existsSync(join(root, top))) continue;
    for (const d of readdirSync(join(root, top))) {
      const m = `${top}/${d}/package.json`;
      if (existsSync(join(root, m))) manifests.push(m);
    }
  }
  for (const m of manifests) {
    let license;
    try {
      license = JSON.parse(readFileSync(join(root, m), 'utf8')).license;
    } catch (e) {
      problems.push(`${m}  unreadable: ${e.message}`);
      continue;
    }
    if (license !== LICENSE_ID) problems.push(`${m}  license is ${JSON.stringify(license)}, expected "${LICENSE_ID}"`);
  }

  for (const top of ['apps', 'packages']) {
    if (!existsSync(join(root, top))) continue;
    for (const rel of walk(join(root, top), root)) {
      problems.push(...scanFile(rel, readFileSync(join(root, rel), 'utf8')));
    }
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = run(fileURLToPath(new URL('..', import.meta.url)));
  if (problems.length > 0) {
    console.error('check-legal: problems found (SPEC 1.5 clean-room / AGPL posture):');
    for (const p of problems) console.error(`  ${p}`);
    console.error(`${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log('check-legal: ok');
}
