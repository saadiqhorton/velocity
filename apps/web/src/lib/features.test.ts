import { describe, expect, it } from 'vitest';
import { ALL_FEATURES, featuresOf, teamUsesCycles } from './features';

describe('featuresOf', () => {
  it('treats a server without the field as everything on', () => {
    expect(featuresOf(null)).toEqual(ALL_FEATURES);
    expect(featuresOf({} as never)).toEqual(ALL_FEATURES);
  });
  it('derives solo from the four flags', () => {
    const off = { cycles: false, estimates: false, insights: false, members: false, solo: false };
    expect(featuresOf({ features: off } as never).solo).toBe(true);
    expect(featuresOf({ features: { ...off, members: true } } as never).solo).toBe(false);
  });
  it('needs both the workspace feature and the team setting for cycles', () => {
    expect(teamUsesCycles(ALL_FEATURES, { cycleEnabled: true })).toBe(true);
    expect(teamUsesCycles({ ...ALL_FEATURES, cycles: false }, { cycleEnabled: true })).toBe(false);
    expect(teamUsesCycles(ALL_FEATURES, { cycleEnabled: false })).toBe(false);
    expect(teamUsesCycles(ALL_FEATURES, null)).toBe(false);
  });
});
