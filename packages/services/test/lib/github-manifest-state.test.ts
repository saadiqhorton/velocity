import { describe, expect, it } from 'vitest';
import { createGithubManifestState, verifyGithubManifestState } from '../../src/lib/github-manifest-state';

const SECRET = 'state-secret-state-secret-state-secret-0123456789';

describe('github manifest state', () => {
  it('verifies a state it just minted', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    const state = createGithubManifestState(SECRET, now);
    expect(state.split('.')).toHaveLength(3);
    expect(verifyGithubManifestState(SECRET, state, now)).toBe(true);
  });

  it('rejects tampering, a different secret, and malformed values', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    const state = createGithubManifestState(SECRET, now);
    expect(verifyGithubManifestState(SECRET, `${state}x`, now)).toBe(false);
    expect(verifyGithubManifestState('another-secret-another-secret-000000', state, now)).toBe(false);
    expect(verifyGithubManifestState(SECRET, null, now)).toBe(false);
    expect(verifyGithubManifestState(SECRET, 'a.b', now)).toBe(false);
    expect(verifyGithubManifestState(SECRET, 'nonce.abc.sig', now)).toBe(false);
  });

  it('expires after one hour', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    const state = createGithubManifestState(SECRET, now);
    expect(verifyGithubManifestState(SECRET, state, now + 59 * 60 * 1000)).toBe(true);
    expect(verifyGithubManifestState(SECRET, state, now + 61 * 60 * 1000)).toBe(false);
    // A state from the future is not accepted (clock skew guard).
    expect(verifyGithubManifestState(SECRET, state, now - 1000)).toBe(false);
  });
});
