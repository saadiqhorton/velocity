import { connect } from 'node:net';
import { and, eq, isNull } from 'drizzle-orm';
import sharp from 'sharp';
import { v7 as uuidv7 } from 'uuid';
import { attachments, comments, issues } from '@velocity/schema';
import { ServiceBase } from './base';
import type { ServiceActor } from './context';
import { actorUserId } from './context';
import { notFound, validation } from './errors';
import { hmacSha256Hex, timingSafeEqualStr } from './lib/crypto';
import { assertCan } from './lib/permissions';

export type AttachmentRow = typeof attachments.$inferSelect;

/** SPEC §5.8 / §7.1.3: mime allowlist; images re-encoded to strip EXIF. */
export const MIME_ALLOWLIST = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/zip',
  'video/mp4',
  'video/webm',
]);
const REENCODE = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const INLINE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm']);

function sniff(buf: Buffer): string | null {
  const b = buf;
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'application/zip';
  return null;
}

function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_').trim().slice(0, 200);
  return cleaned || 'file';
}

/** clamd INSTREAM scan. Resolves the verdict line, e.g. `stream: OK`. */
function clamScan(host: string, port: number, data: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    let reply = '';
    sock.setTimeout(30_000, () => sock.destroy(new Error('ClamAV scan timed out')));
    sock.on('error', reject);
    sock.on('data', (d) => (reply += d.toString('utf8')));
    sock.on('end', () => resolve(reply.replace(/\0/g, '').trim()));
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      for (let i = 0; i < data.length; i += 64 * 1024) {
        const chunk = data.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(len);
        sock.write(chunk);
      }
      sock.end(Buffer.alloc(4));
    });
  });
}

export class AttachmentService extends ServiceBase {
  async upload(actor: ServiceActor, input: { issueId?: string | null; commentId?: string | null; filename: string; mime: string; data: Buffer }): Promise<AttachmentRow> {
    assertCan(actor, 'issue.write');
    const maxBytes = this.config.maxUploadMb * 1024 * 1024;
    if (input.data.length === 0) throw validation('The file is empty.');
    if (input.data.length > maxBytes) throw validation(`Files are limited to ${this.config.maxUploadMb} MB.`);
    let mime = (input.mime || 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
    const sniffed = sniff(input.data);
    if (sniffed) mime = sniffed; // trust magic bytes over the client's claim
    else if (mime.startsWith('image/') || mime === 'application/pdf' || mime === 'application/zip') {
      throw validation('The file’s contents don’t match its type.');
    }
    if (!MIME_ALLOWLIST.has(mime)) throw validation('That file type isn’t allowed. Upload images, PDFs, text, CSV, JSON, ZIP or MP4/WebM video.');
    if (input.issueId) {
      const [i] = await this.db.select({ id: issues.id }).from(issues).where(eq(issues.id, input.issueId));
      if (!i) throw notFound('Issue');
    }
    if (input.commentId) {
      const [c] = await this.db.select({ id: comments.id }).from(comments).where(eq(comments.id, input.commentId));
      if (!c) throw notFound('Comment');
    }
    let data = input.data;
    if (REENCODE.has(mime)) {
      // Re-encoding drops EXIF/XMP/ICC metadata (GPS etc.); .rotate() bakes in orientation first.
      const img = sharp(data, { failOn: 'error', limitInputPixels: 100_000_000 }).rotate();
      data = mime === 'image/png' ? await img.png().toBuffer() : mime === 'image/webp' ? await img.webp().toBuffer() : await img.jpeg({ quality: 90 }).toBuffer();
    }
    if (this.config.clamav) {
      const verdict = await clamScan(this.config.clamav.host, this.config.clamav.port, data);
      if (!verdict.endsWith('OK')) {
        this.logger.warn({ verdict, filename: input.filename }, 'upload rejected by ClamAV');
        throw validation('This file was flagged by the virus scanner and wasn’t uploaded.');
      }
    }
    const id = uuidv7();
    const now = this.now();
    const storagePath = `attachments/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
    await this.storage.put(storagePath, data);
    const [row] = await this.db
      .insert(attachments)
      .values({
        id,
        issueId: input.issueId ?? null,
        commentId: input.commentId ?? null,
        uploaderId: actorUserId(actor),
        storagePath,
        filename: safeFilename(input.filename),
        mime,
        size: data.length,
      })
      .returning();
    return row!;
  }

  async get(id: string): Promise<AttachmentRow | null> {
    const [a] = await this.db.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.trashedAt)));
    return a ?? null;
  }

  async listForIssue(issueId: string): Promise<AttachmentRow[]> {
    return this.db.select().from(attachments).where(and(eq(attachments.issueId, issueId), isNull(attachments.trashedAt)));
  }

  async open(row: AttachmentRow) {
    return this.storage.get(row.storagePath);
  }

  async delete(actor: ServiceActor, id: string): Promise<void> {
    assertCan(actor, 'issue.write');
    const a = await this.get(id);
    if (!a) throw notFound('Attachment');
    await this.db.delete(attachments).where(eq(attachments.id, id));
    await this.storage.delete(a.storagePath).catch(() => {});
  }

  /** Presigned-style, time-limited URL for editor embeds (SPEC §5.8). */
  signedPath(id: string, ttlSeconds = 3600): string {
    const exp = Math.floor(this.now().getTime() / 1000) + ttlSeconds;
    const sig = hmacSha256Hex(this.config.appSecret, `file:${id}:${exp}`).slice(0, 32);
    return `/files/${id}?exp=${exp}&sig=${sig}`;
  }

  verifySignature(id: string, exp: string | null, sig: string | null): boolean {
    if (!exp || !sig || !/^\d+$/.test(exp)) return false;
    if (Number(exp) < Math.floor(this.now().getTime() / 1000)) return false;
    return timingSafeEqualStr(hmacSha256Hex(this.config.appSecret, `file:${id}:${exp}`).slice(0, 32), sig);
  }
}
