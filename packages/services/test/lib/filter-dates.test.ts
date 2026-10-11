import { describe, expect, it } from 'vitest';
import { normalizeOffsetless } from '../../src/issues/filter-sql';

/**
 * Filter timestamps without a zone are UTC everywhere else in the system (the date-only branch above
 * forces `T00:00:00.000Z`). Parsing them with `new Date` would silently use the server's timezone, so
 * the same saved view would select different rows on two hosts configured differently.
 */
describe('filter date parsing', () => {
  it('reads an offset-less timestamp as UTC', () => {
    expect(normalizeOffsetless('2026-01-01T00:30')).toBe('2026-01-01T00:30Z');
    expect(normalizeOffsetless('2026-01-01T00:30:15')).toBe('2026-01-01T00:30:15Z');
    expect(normalizeOffsetless('2026-01-01T00:30:15.250')).toBe('2026-01-01T00:30:15.250Z');
    expect(new Date(normalizeOffsetless('2026-01-01T00:30')).toISOString()).toBe('2026-01-01T00:30:00.000Z');
  });

  it('leaves an explicit offset or zone alone', () => {
    expect(normalizeOffsetless('2026-01-01T00:30Z')).toBe('2026-01-01T00:30Z');
    expect(normalizeOffsetless('2026-01-01T00:30+02:00')).toBe('2026-01-01T00:30+02:00');
    expect(normalizeOffsetless('2026-01-01T00:30:15-05:00')).toBe('2026-01-01T00:30:15-05:00');
    expect(new Date(normalizeOffsetless('2026-01-01T00:30+02:00')).toISOString()).toBe('2025-12-31T22:30:00.000Z');
  });

  it('does not touch a date-only value (the caller appends its own UTC midnight)', () => {
    expect(normalizeOffsetless('2026-01-01')).toBe('2026-01-01');
  });
});
