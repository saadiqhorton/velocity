import { randomBytes } from 'node:crypto';
import { hmacSha256Hex, timingSafeEqualStr } from './crypto';

/**
 * Stateless CSRF token for the GitHub App manifest flow. The value is `<nonce>.<issuedAt>.<hmac>`;
 * only the server can mint one (the flow is owner-only), and `verifyGithubManifestState` checks the
 * signature and age. This binds the OAuth-style `code` GitHub returns to a flow the owner started,
 * so an attacker cannot trick an owner into exchanging the attacker's registration code.
 */
const TTL_MS = 60 * 60 * 1000;

function sign(appSecret: string, input: string): string {
  return hmacSha256Hex(appSecret, input).slice(0, 32);
}

export function createGithubManifestState(appSecret: string, now = Date.now()): string {
  const nonce = randomBytes(12).toString('base64url');
  const issuedAt = String(now);
  const body = `${nonce}.${issuedAt}`;
  return `${body}.${sign(appSecret, body)}`;
}

export function verifyGithubManifestState(appSecret: string, state: string | null | undefined, now = Date.now()): boolean {
  if (typeof state !== 'string') return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [nonce, issuedAt, mac] = parts as [string, string, string];
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(nonce) || !/^\d{10,}$/.test(issuedAt)) return false;
  if (!timingSafeEqualStr(mac, sign(appSecret, `${nonce}.${issuedAt}`))) return false;
  const age = now - Number(issuedAt);
  return age >= 0 && age <= TTL_MS;
}
