import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createCipherBox, generateApiKey, hmacSha256Hex, randomToken, sha256Hex, timingSafeEqualStr, verifyHmacSignature } from '../../src/lib/crypto';

const SECRET = 'a'.repeat(32);

describe('randomToken', () => {
  it('is base64url with the right length and unique', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(Array.from({ length: 1000 }, () => randomToken())).size).toBe(1000);
  });
  it('validates bytes', () => {
    expect(() => randomToken(0)).toThrow(RangeError);
    expect(() => randomToken(1.5)).toThrow(RangeError);
  });
});

describe('generateApiKey', () => {
  it('has vel_ + 40 base62 chars and a derivable prefix', () => {
    const { key, prefix } = generateApiKey();
    expect(key).toMatch(/^vel_[0-9A-Za-z]{40}$/);
    expect(prefix).toBe(key.slice(0, 12));
    expect(prefix).toMatch(/^vel_[0-9A-Za-z]{8}$/);
  });
  it('is unique and uses the whole alphabet', () => {
    const keys = Array.from({ length: 500 }, () => generateApiKey().key);
    expect(new Set(keys).size).toBe(500);
    const chars = new Set(keys.join('').replaceAll('vel_', ''));
    expect(chars.size).toBe(62);
  });
});

describe('hashing', () => {
  it('sha256Hex known vector', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('hmacSha256Hex matches RFC 4231 test case 2', () => {
    expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });
  it('hmac accepts bytes', () => expect(hmacSha256Hex('k', Buffer.from('body'))).toBe(hmacSha256Hex('k', 'body')));
});

describe('timingSafeEqualStr', () => {
  it('compares correctly incl. different lengths and unicode', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStr('', '')).toBe(true);
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualStr('', 'a')).toBe(false);
    expect(timingSafeEqualStr('héllo', 'héllo')).toBe(true);
    expect(timingSafeEqualStr('héllo', 'hello')).toBe(false);
  });
});

describe('verifyHmacSignature', () => {
  const body = '{"action":"opened"}';
  const sig = createHmac('sha256', 'secret').update(body).digest('hex');
  it('accepts GitHub-style sha256= header', () => expect(verifyHmacSignature('secret', body, `sha256=${sig}`)).toBe(true));
  it('accepts uppercase hex and byte bodies', () => {
    expect(verifyHmacSignature('secret', body, `sha256=${sig.toUpperCase()}`)).toBe(true);
    expect(verifyHmacSignature('secret', Buffer.from(body), `sha256=${sig}`)).toBe(true);
  });
  it('rejects wrong secret / body / prefix / missing header / garbage', () => {
    expect(verifyHmacSignature('other', body, `sha256=${sig}`)).toBe(false);
    expect(verifyHmacSignature('secret', body + ' ', `sha256=${sig}`)).toBe(false);
    expect(verifyHmacSignature('secret', body, sig)).toBe(false);
    expect(verifyHmacSignature('secret', body, `sha1=${sig}`)).toBe(false);
    expect(verifyHmacSignature('secret', body, undefined)).toBe(false);
    expect(verifyHmacSignature('secret', body, null)).toBe(false);
    expect(verifyHmacSignature('secret', body, '')).toBe(false);
    expect(verifyHmacSignature('secret', body, 'sha256=')).toBe(false);
    expect(verifyHmacSignature('secret', body, `sha256=${sig.slice(0, -2)}`)).toBe(false);
  });
  it('supports custom prefix / bare hex', () => {
    expect(verifyHmacSignature('secret', body, sig, '')).toBe(true);
    expect(verifyHmacSignature('secret', body, `v1=${sig}`, 'v1=')).toBe(true);
  });
});

describe('createCipherBox', () => {
  it('requires a >= 32 char secret', () => {
    expect(() => createCipherBox('short')).toThrow();
    expect(() => createCipherBox('a'.repeat(31))).toThrow();
    expect(() => createCipherBox('a'.repeat(32))).not.toThrow();
  });
  it('roundtrips various plaintexts', () => {
    const box = createCipherBox(SECRET);
    for (const p of ['', 'x', 'hello world', 'ünïcödé 日本語 😀', 'a'.repeat(100_000), '{"token":"ghs_abc"}']) {
      const c = box.encrypt(p);
      expect(c.startsWith('v1:')).toBe(true);
      expect(c).toMatch(/^v1:[A-Za-z0-9_-]+$/);
      expect(box.decrypt(c)).toBe(p);
    }
  });
  it('is non-deterministic (unique IV) and does not leak plaintext', () => {
    const box = createCipherBox(SECRET);
    const set = new Set(Array.from({ length: 200 }, () => box.encrypt('same')));
    expect(set.size).toBe(200);
    expect(box.encrypt('supersecretvalue')).not.toContain('supersecretvalue');
  });
  it('detects tampering of any byte region', () => {
    const box = createCipherBox(SECRET);
    const c = box.encrypt('payload that matters');
    const raw = Buffer.from(c.slice(3), 'base64url');
    for (const pos of [0, 11, 12, 27, 28, raw.length - 1]) {
      const t = Buffer.from(raw);
      t[pos] = (t[pos] as number) ^ 1;
      expect(() => box.decrypt('v1:' + t.toString('base64url'))).toThrow();
    }
    expect(() => box.decrypt('v1:' + raw.subarray(0, raw.length - 1).toString('base64url'))).toThrow();
  });
  it('rejects malformed/unsupported input', () => {
    const box = createCipherBox(SECRET);
    expect(() => box.decrypt('')).toThrow();
    expect(() => box.decrypt('v2:abcd')).toThrow(/format/);
    expect(() => box.decrypt('v1:')).toThrow();
    expect(() => box.decrypt('v1:AAAA')).toThrow();
    expect(() => box.decrypt('plaintext')).toThrow();
  });
  it('fails with the wrong key but works across instances with the same key', () => {
    const c = createCipherBox(SECRET).encrypt('hi');
    expect(createCipherBox(SECRET).decrypt(c)).toBe('hi');
    expect(() => createCipherBox('b'.repeat(32)).decrypt(c)).toThrow();
    expect(() => createCipherBox(SECRET + 'x').decrypt(c)).toThrow();
  });
});
