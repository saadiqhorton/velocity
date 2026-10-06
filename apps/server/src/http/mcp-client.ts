import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SECURITY_HEADERS, sendText } from './util';

const NAME = /^client-([0-9a-f]{12})\.tgz$/;

/**
 * The packed stdio client (apps/mcp build). The bundled server ships it in dist/mcp next to
 * main.js; from source (tsx/vitest) it lives in apps/mcp/dist.
 */
export function findMcpClient(moduleUrl: string): { hash: string; file: string } | null {
  const self = fileURLToPath(moduleUrl);
  const dir = self.endsWith('.js') ? join(dirname(self), 'mcp') : join(dirname(self), '../../mcp/dist');
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    const m = NAME.exec(name);
    if (m?.[1]) return { hash: m[1], file: join(dir, name) };
  }
  return null;
}

/**
 * GET /mcp/client-<hash>.tgz — public (the tarball holds no secrets). The name is the content hash
 * (see apps/mcp/build.mjs), so npx's cache never serves a stale client; only the shipped name resolves.
 */
export function createMcpClientHandler(file: string | null) {
  const hash = file ? (NAME.exec(basename(file))?.[1] ?? null) : null;
  let bytes: Buffer | null = null;
  return (req: IncomingMessage, res: ServerResponse, requested: string): void => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !file || !hash || requested !== hash) {
      return sendText(res, 404, 'Not found');
    }
    bytes ??= readFileSync(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'application/gzip',
      'content-length': bytes.length,
      'content-disposition': `attachment; filename="client-${hash}.tgz"`,
      'cache-control': 'public, max-age=31536000, immutable',
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  };
}

export const MCP_CLIENT_PATH = /^\/mcp\/client-(.+)\.tgz$/;
