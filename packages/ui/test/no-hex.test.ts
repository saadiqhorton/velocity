/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\w])\/\/.*$/gm, '$1');
}

describe('design token discipline', () => {
  it('contains no hex color literals in packages/ui/src', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const matches = code.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (matches) offenders.push(`${file}: ${matches.join(', ')}`);
      if (/\brgba?\(/.test(code)) offenders.push(`${file}: rgb() literal`);
      if (/\[#|-\[(?:rgb|hsl|oklch)/.test(code)) offenders.push(`${file}: arbitrary color value`);
    }
    expect(offenders).toEqual([]);
  });
});
