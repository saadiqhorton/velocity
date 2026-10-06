import { describe, expect, it } from 'vitest';
import type { UserPreferences } from '@velocity/schema';
import { safeUserPreferences, validateUserPreferences } from '../../src/lib/user-preferences';

const good: UserPreferences = {
  codingTools: [
    { id: 'codex', preset: 'codex', name: 'Codex', kind: 'deeplink', template: 'codex://new?prompt={prompt}', enabled: true },
    { id: 'my-tool', name: 'My Tool', kind: 'command', template: 'my-tool {prompt}', enabled: false },
  ],
  promptInstructions: 'Run the tests.',
};

describe('coding tool preferences', () => {
  it('accepts built-in app links and commands', () => {
    expect(validateUserPreferences(good)).toEqual(good);
    expect(validateUserPreferences({ codingTools: [{ ...good.codingTools[0]!, template: 'https://example.com/start?text={prompt}' }], promptInstructions: '' }).codingTools).toHaveLength(1);
    expect(validateUserPreferences({ codingTools: [{ id: 'pi', preset: 'pi', name: 'pi', kind: 'command', template: 'pi {prompt}', enabled: true }], promptInstructions: '' }).codingTools[0]?.preset).toBe('pi');
  });

  it.each(['javascript:alert({prompt})', 'file:///tmp/{prompt}', 'data:text/plain,{prompt}', 'ftp://host/{prompt}', 'https://user:pass@example.com/{prompt}', 'https://host/space here?x={prompt}'])(
    'rejects unsafe deep link %s', (template) => {
      expect(() => validateUserPreferences({ ...good, codingTools: [{ ...good.codingTools[0]!, template }] })).toThrow();
    },
  );

  it('rejects missing placeholders, duplicate IDs, unknown presets and excessive input', () => {
    const tool = good.codingTools[0]!;
    expect(() => validateUserPreferences({ ...good, codingTools: [{ ...tool, template: 'codex://new' }] })).toThrow();
    expect(() => validateUserPreferences({ ...good, codingTools: [tool, tool] })).toThrow();
    expect(() => validateUserPreferences({ ...good, codingTools: [{ ...tool, preset: 'unknown' }] })).toThrow();
    expect(() => validateUserPreferences({ ...good, codingTools: [{ ...tool, template: 'x'.repeat(2_001) }] })).toThrow();
    expect(() => validateUserPreferences({ ...good, promptInstructions: 'x'.repeat(4_001) })).toThrow();
  });

  it('reads stored values defensively and degrades malformed JSONB to null', () => {
    expect(safeUserPreferences(good)).toEqual(good);
    // Anything unexpected returns null (treated as "not saved") instead of failing the query.
    expect(safeUserPreferences(null)).toBeNull();
    expect(safeUserPreferences('nope')).toBeNull();
    expect(safeUserPreferences({ codingTools: 'x', promptInstructions: '' })).toBeNull();
    expect(safeUserPreferences({ codingTools: [], promptInstructions: 7 })).toBeNull();
    expect(safeUserPreferences({ codingTools: [{ id: 'x', name: 'X', kind: 'run', template: 'x {prompt}', enabled: true }], promptInstructions: '' })).toBeNull();
    expect(safeUserPreferences({ codingTools: [{ id: 'x', name: 'X', kind: 'command', template: 'x {prompt}', enabled: true, extra: 1 }], promptInstructions: '' })).toBeNull();
    expect(safeUserPreferences({ ...good, extra: true })).toBeNull();
  });
});
