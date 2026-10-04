import { describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from '../../src/lib/common-passwords';
import { validatePassword } from '../../src/lib/password-policy';

describe('common password list', () => {
  it('has >= 300 unique entries, all lowercase and >= 10 chars', () => {
    expect(COMMON_PASSWORDS.length).toBeGreaterThanOrEqual(300);
    expect(new Set(COMMON_PASSWORDS).size).toBe(COMMON_PASSWORDS.length);
    for (const p of COMMON_PASSWORDS) {
      expect(p.length).toBeGreaterThanOrEqual(10);
      expect(p).toBe(p.toLowerCase());
    }
  });
  it('includes the canonical examples', () => {
    for (const p of ['1234567890', 'qwertyuiop', 'password123', 'iloveyou12']) expect(COMMON_PASSWORDS).toContain(p);
  });
  it('every entry is rejected as common', () => {
    for (const p of COMMON_PASSWORDS) {
      const r = validatePassword(p);
      expect(r.ok).toBe(false);
    }
  });
});

describe('validatePassword', () => {
  it('accepts a strong passphrase', () => expect(validatePassword('correct horse battery staple')).toEqual({ ok: true }));
  it('accepts exactly 10 chars', () => expect(validatePassword('x7Qm!pL2vz')).toEqual({ ok: true }));
  it('rejects short passwords with a hint', () => {
    for (const pw of ['', 'a', 'x7Qm!pL2v']) {
      const r = validatePassword(pw);
      expect(r).toMatchObject({ ok: false, reason: 'too_short' });
      if (!r.ok) expect(r.message).toMatch(/10 characters/);
    }
  });
  it('rejects common passwords case-insensitively', () => {
    for (const pw of ['1234567890', 'QWERTYUIOP', 'PassWord123', 'ILoveYou12']) {
      const r = validatePassword(pw);
      expect(r).toMatchObject({ ok: false, reason: 'common' });
      if (!r.ok) expect(r.message.length).toBeGreaterThan(20);
    }
  });
  it('short wins over common', () => expect(validatePassword('qwerty')).toMatchObject({ reason: 'too_short' }));
  it('rejects passwords containing the username (>= 4 chars)', () => {
    expect(validatePassword('xxJohnDoexx99', { username: 'johndoe' })).toMatchObject({ ok: false, reason: 'matches_identity' });
    expect(validatePassword('johndoe', { username: 'johndoe' })).toMatchObject({ reason: 'too_short' });
    expect(validatePassword('JOHNDOE-2026!', { username: 'johndoe' })).toMatchObject({ reason: 'matches_identity' });
  });
  it('ignores short usernames', () => expect(validatePassword('zq-bob-x7Qm!pL2', { username: 'bob' })).toEqual({ ok: true }));
  it('rejects passwords containing the email local part', () => {
    expect(validatePassword('my-alice.smith-pw1', { email: 'alice.smith@example.com' })).toMatchObject({ reason: 'matches_identity' });
    expect(validatePassword('ALICE.SMITH!!!!', { email: 'Alice.Smith@example.com' })).toMatchObject({ reason: 'matches_identity' });
  });
  it('does not match on the email domain alone, short local parts, or null email', () => {
    expect(validatePassword('example.com-x7Qm!pL', { email: 'alice@example.com' })).toEqual({ ok: true });
    expect(validatePassword('zz-abc-x7Qm!pL2vz', { email: 'abc@example.com' })).toEqual({ ok: true });
    expect(validatePassword('x7Qm!pL2vzzz', { email: null, username: '' })).toEqual({ ok: true });
  });
  it('treats a malformed email as a local part', () => {
    expect(validatePassword('prefix-nolocal-x1', { email: 'nolocal' })).toMatchObject({ reason: 'matches_identity' });
  });
});
