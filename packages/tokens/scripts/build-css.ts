import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTokensCss } from '../src/css';

const dir = fileURLToPath(new URL('../dist/', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}tokens.css`, buildTokensCss());
console.log(`wrote ${dir}tokens.css`);
