import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SECURITY_HEADERS, sendText } from './util';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

/** Strict CSP (SPEC §7.1.4): no inline scripts; editor styles are nonce'd. */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function createStaticHandler(webDistDir: string) {
  const root = resolve(webDistDir);
  const indexPath = join(root, 'index.html');
  let indexTemplate: string | null = null;
  const loadIndex = (): string | null => {
    if (indexTemplate !== null && process.env.NODE_ENV === 'production') return indexTemplate;
    if (!existsSync(indexPath)) return null;
    indexTemplate = readFileSync(indexPath, 'utf8');
    return indexTemplate;
  };

  const serveIndex = (res: ServerResponse) => {
    const tpl = loadIndex();
    if (!tpl) {
      sendText(res, 503, 'The web app has not been built yet. Run `pnpm --filter @velocity/web build`.');
      return;
    }
    const nonce = randomBytes(16).toString('base64');
    const html = tpl.replace('<head>', `<head>\n    <meta name="csp-nonce" content="${nonce}">`);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'content-security-policy': contentSecurityPolicy(nonce),
    });
    res.end(html);
  };

  return (req: IncomingMessage, res: ServerResponse, pathname: string): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method not allowed');
      return;
    }
    if (pathname === '/' || pathname === '/index.html') return serveIndex(res);
    const file = normalize(join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root + sep)) {
      sendText(res, 400, 'Bad path');
      return;
    }
    let st: ReturnType<typeof statSync> | null = null;
    try {
      st = statSync(file);
    } catch {
      st = null;
    }
    if (st?.isFile()) {
      const ext = extname(file);
      const immutable = pathname.startsWith('/assets/');
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'content-length': st.size,
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(file).pipe(res);
      return;
    }
    if (extname(pathname) && pathname.startsWith('/assets/')) {
      sendText(res, 404, 'Not found');
      return;
    }
    // SPA fallback: client-side routes render index.html.
    serveIndex(res);
  };
}
