import type { IncomingMessage, ServerResponse } from 'node:http';

export function clientIp(req: IncomingMessage, trustProxy: boolean): string | null {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const parts = (Array.isArray(xff) ? xff.join(',') : xff)?.split(',').map((v) => v.trim()).filter(Boolean);
    // The proxy appends the address it received the request from, so the last hop is the one a client
    // cannot forge; anything leading it is whatever the client itself sent in the header.
    const last = parts?.[parts.length - 1];
    if (last) return last;
  }
  return req.socket.remoteAddress ?? null;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data), 'cache-control': 'no-store', ...headers });
  res.end(data);
}

export function sendText(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

export async function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > limitBytes) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/** Minimal Headers-like adapter over Node's IncomingHttpHeaders. */
export function headerGetter(req: IncomingMessage): { get(name: string): string | null } {
  return {
    get(name: string) {
      const v = req.headers[name.toLowerCase()];
      if (v === undefined) return null;
      return Array.isArray(v) ? v.join(', ') : v;
    },
  };
}

export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
