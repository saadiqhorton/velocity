import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Services } from '@velocity/services';
import { INLINE_MIME } from '@velocity/services';
import { authenticate } from '../graphql-server';
import { SECURITY_HEADERS, headerGetter, sendText } from './util';

function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Attachment downloads (SPEC §5.8): auth-scoped — either a valid signed URL
 * (time-limited, for editor embeds) or an authenticated member/API key.
 */
export async function handleFile(services: Services, req: IncomingMessage, res: ServerResponse, url: URL, ip: string | null): Promise<void> {
  const id = url.pathname.split('/')[2] ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return sendText(res, 404, 'Not found');
  const signed = services.attachments.verifySignature(id, url.searchParams.get('exp'), url.searchParams.get('sig'));
  if (!signed) {
    const auth = await authenticate(services, headerGetter(req), ip).catch(() => null);
    if (!auth?.actor) return sendText(res, 401, 'Sign in to view this file.');
  }
  const row = await services.attachments.get(id);
  if (!row) return sendText(res, 404, 'Not found');
  const stream = await services.attachments.open(row);
  const inline = INLINE_MIME.has(row.mime);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': row.mime,
    'content-length': row.size,
    'content-disposition': contentDisposition(inline ? 'inline' : 'attachment', row.filename),
    'cache-control': 'private, max-age=3600',
    // Uploaded files never execute: sandbox even if a browser sniffs content.
    'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** Workspace export download (owner session). */
export async function handleExportDownload(services: Services, req: IncomingMessage, res: ServerResponse, url: URL, ip: string | null): Promise<void> {
  const id = url.pathname.split('/')[3] ?? '';
  const auth = await authenticate(services, headerGetter(req), ip).catch(() => null);
  if (!auth?.actor) return sendText(res, 401, 'Sign in to download exports.');
  try {
    const row = await services.exports.get(auth.actor, id);
    if (row.status !== 'completed' || !row.filePath) return sendText(res, 409, 'This export is not ready yet.');
    const st = statSync(row.filePath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'application/json',
      'content-length': st.size,
      'content-disposition': contentDisposition('attachment', `velocity-export-${row.createdAt.toISOString().slice(0, 10)}.json`),
      'cache-control': 'no-store',
    });
    createReadStream(row.filePath).pipe(res);
  } catch (err) {
    const code = (err as { code?: string }).code;
    sendText(res, code === 'FORBIDDEN' ? 403 : 404, code === 'FORBIDDEN' ? 'Only the workspace owner can download exports.' : 'Not found');
  }
}
