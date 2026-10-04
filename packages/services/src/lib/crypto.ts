import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Random base64url token (default 128 bits). */
export function randomToken(bytes = 16): string {
  if (!Number.isInteger(bytes) || bytes < 1) throw new RangeError('bytes must be a positive integer');
  return randomBytes(bytes).toString('base64url');
}

/** `vel_` + 40 base62 chars (unbiased); `prefix` = `vel_` + first 8 chars, for display/lookup. */
export function generateApiKey(): { key: string; prefix: string } {
  let body = '';
  while (body.length < 40) {
    for (const b of randomBytes(64)) {
      if (b < 248 && body.length < 40) body += B62[b % 62];
    }
  }
  return { key: `vel_${body}`, prefix: `vel_${body.slice(0, 8)}` };
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function hmacSha256Hex(secret: string, body: string | Uint8Array): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Constant-time string equality; safe for different lengths. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/** Verify `header` (e.g. `sha256=<hex>`) against HMAC-SHA256(secret, body). */
export function verifyHmacSignature(secret: string, body: string | Uint8Array, header: string | null | undefined, prefix = 'sha256='): boolean {
  if (typeof header !== 'string' || !header.startsWith(prefix)) return false;
  const given = header.slice(prefix.length).trim().toLowerCase();
  return timingSafeEqualStr(given, hmacSha256Hex(secret, body));
}

const INFO = 'velocity:column-encryption:v1';
const VERSION = 'v1:';

export interface CipherBox {
  encrypt(plain: string): string;
  decrypt(boxed: string): string;
}

/** AES-256-GCM box; key = HKDF-SHA256(APP_SECRET). Format: `v1:` + base64url(iv[12] | tag[16] | ciphertext). */
export function createCipherBox(appSecret: string): CipherBox {
  if (typeof appSecret !== 'string' || appSecret.length < 32) throw new Error('APP_SECRET must be at least 32 characters');
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(appSecret, 'utf8'), Buffer.alloc(0), Buffer.from(INFO, 'utf8'), 32));
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return VERSION + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
    },
    decrypt(boxed) {
      if (typeof boxed !== 'string' || !boxed.startsWith(VERSION)) throw new Error('unsupported ciphertext format');
      const raw = Buffer.from(boxed.slice(VERSION.length), 'base64url');
      if (raw.length < 28) throw new Error('ciphertext too short');
      const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    },
  };
}
