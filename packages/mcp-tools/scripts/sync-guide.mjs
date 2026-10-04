// Regenerates src/guide.ts from docs/agents.md (the single source of truth).
// Run: node scripts/sync-guide.mjs   (a test asserts the two stay in sync)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(resolve(here, '../../../docs/agents.md'), 'utf8');
const lines = md.replace(/\n$/, '').split('\n');
const body = lines.map((l) => `  ${JSON.stringify(l)},`).join('\n');
const out = `// GENERATED from docs/agents.md by scripts/sync-guide.mjs. Do not edit; edit the markdown and re-run.\nexport const AGENT_GUIDE: string = [\n${body}\n].join('\\n') + '\\n';\n`;
writeFileSync(resolve(here, '../src/guide.ts'), out);
