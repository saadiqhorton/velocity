import { COMMON_PASSWORDS } from './common-passwords';

export const MIN_PASSWORD_LENGTH = 10;

export type PasswordResult =
  | { ok: true }
  | { ok: false; reason: 'too_short' | 'common' | 'matches_identity'; message: string };

const COMMON = new Set<string>(COMMON_PASSWORDS.map((p) => p.toLowerCase()));

function localPart(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

/** SPEC §3.2.1 / §4.14: min 10 chars, not common, not containing the username / email local part (when >= 4 chars). */
export function validatePassword(pw: string, ctx: { username?: string; email?: string | null } = {}): PasswordResult {
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: 'too_short',
      message: `Passwords need at least ${MIN_PASSWORD_LENGTH} characters. Try a passphrase of three or four unrelated words.`,
    };
  }
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) {
    return { ok: false, reason: 'common', message: 'That password appears in lists of commonly breached passwords. Choose something less predictable, such as a passphrase.' };
  }
  const identities = [ctx.username, ctx.email ? localPart(ctx.email) : undefined]
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length >= 4);
  if (identities.some((id) => lower.includes(id))) {
    return { ok: false, reason: 'matches_identity', message: 'Your password should not contain your username or email address. Pick something unrelated to who you are.' };
  }
  return { ok: true };
}
