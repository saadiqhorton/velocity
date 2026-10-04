import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanFile } from './check-legal.mjs';

test('flags asset hosts outside importers', () => {
  assert.equal(scanFile('apps/web/src/a.ts', 'const u = "https://cdn.linear.app/x.png"').length, 1);
  assert.equal(scanFile('packages/importers/src/a.ts', 'https://cdn.linear.app/x.png').length, 0);
});

test('flags "Linear" in web UI copy, allows sanctioned comments', () => {
  assert.equal(scanFile('apps/web/src/a.tsx', '<h1>Linear for teams</h1>').length, 1);
  assert.equal(scanFile('apps/web/src/a.tsx', '// Linear-parity geometry (SPEC 4.10)').length, 0);
  assert.equal(scanFile('apps/web/src/a.tsx', ' * A Linear-style list').length, 0);
  assert.equal(scanFile('apps/web/src/a.tsx', "// uses Linear's public API").length, 0);
  assert.equal(scanFile('apps/web/src/a.tsx', "const x = 'Linear-style'").length, 1);
  assert.equal(scanFile('apps/web/src/a.tsx', 'scaleLinear(); linear-gradient').length, 0);
  assert.equal(scanFile('apps/web/src/import/Wizard.tsx', '<p>Import from Linear</p>').length, 0);
  assert.equal(scanFile('apps/server/src/a.ts', 'Linear').length, 0);
});
