import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from './helpers';
import type { RunningApp } from './helpers';

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-abc.js">
    <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
  </head>
  <body><div id="root"></div></body>
</html>
`;

let dist: string;
let running: RunningApp | undefined;
beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'velocity-static-'));
  writeFileSync(join(dist, 'index.html'), INDEX);
});
afterEach(async () => { await running?.close(); running = undefined; });
afterAll(() => rmSync(dist, { recursive: true, force: true }));

async function getIndex(path: string) {
  const res = await fetch(`${running!.base}${path}`);
  const html = await res.text();
  const csp = res.headers.get('content-security-policy') ?? '';
  const nonce = /style-src 'self' 'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
  return { res, html, csp, nonce };
}

describe('SPA index under the production CSP (SPEC §7.1.4)', () => {
  it('serves a per-request style nonce in both the CSP header and the csp-nonce meta tag', async () => {
    running = await boot({ webDistDir: dist });
    for (const path of ['/', '/team/ENG/active']) {
      const { res, html, csp, nonce } = await getIndex(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(nonce, `style nonce in CSP for ${path}`).toBeTruthy();
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('unsafe-eval');
      expect(html).toContain(`<meta name="csp-nonce" property="csp-nonce" nonce="${nonce}" content="${nonce}">`);
      // Build-emitted tags are same-origin files covered by 'self'; the server must not rewrite them.
      expect(html).toContain('<script type="module" crossorigin src="/assets/index-abc.js"></script>');
      expect(html).toContain('<link rel="stylesheet" crossorigin href="/assets/index-abc.css">');
      expect(html.match(/nonce="/g)).toHaveLength(1);
    }
    const a = await getIndex('/');
    const b = await getIndex('/');
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('limits form-action to self and github.com for the in-app GitHub App manifest form', async () => {
    running = await boot({ webDistDir: dist });
    const { csp } = await getIndex('/');
    const formAction = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('form-action'));
    expect(formAction).toBe("form-action 'self' https://github.com");
  });
});

