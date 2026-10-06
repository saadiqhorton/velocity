import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { persistedOperationQuery } from '../src/persisted-operations';

const hash = 'a'.repeat(64);
const query = 'query Viewer { viewer { id } }';
const documents = { [`sha256:${hash}`]: query };

// The manifest lives in @velocity/graphql so the server never imports apps/web (SPEC §5.3).
const manifestPath = new URL('../../../packages/graphql/persisted-documents.json', import.meta.url);
const shipped = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>;

describe('persisted app operations', () => {
  it('resolves a generated hash to the server-shipped document', () => {
    expect(persistedOperationQuery({ extensions: { persistedQuery: { version: 1, sha256Hash: hash } } }, documents)).toBe(query);
  });

  it('uses the trusted document when a client also sends different text', () => {
    expect(persistedOperationQuery({ query: '{ __schema { types { name } } }', extensions: { persistedQuery: { version: 1, sha256Hash: hash } } }, documents)).toBe(query);
  });

  it('allows ordinary public API operations and old clients that retry with their full text', () => {
    expect(persistedOperationQuery({ query }, documents)).toBeNull();
    expect(persistedOperationQuery({ query, extensions: { persistedQuery: { version: 1, sha256Hash: 'b'.repeat(64) } } }, documents)).toBeNull();
  });

  it('returns the Apollo retry signal for an unknown hash without query text', () => {
    expect(() => persistedOperationQuery({ extensions: { persistedQuery: { version: 1, sha256Hash: 'b'.repeat(64) } } }, documents)).toThrow('PersistedQueryNotFound');
  });

  it('rejects malformed extensions before execution', () => {
    expect(() => persistedOperationQuery({ extensions: { persistedQuery: { version: 2, sha256Hash: hash } } }, documents)).toThrow('Invalid persisted query extension');
    expect(() => persistedOperationQuery({ extensions: { persistedQuery: { version: 1, sha256Hash: 'bogus' } } }, documents)).toThrow('Invalid persisted query extension');
  });

  it('ships the generated manifest from @velocity/graphql with matching hashes and typenames', () => {
    const entries = Object.entries(shipped);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, document] of entries) {
      expect(key).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(key).toBe(`sha256:${createHash('sha256').update(document).digest('hex')}`);
      // Apollo reads cached fragments back, so the server-shipped text needs typenames.
      expect(document).toContain('__typename');
    }
  });
});
