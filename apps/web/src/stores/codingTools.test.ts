import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_SHORTCUT, PRESETS, STORAGE_KEY, clearLegacyConfig, defaultConfig, dedupeShortcuts, isSafeDeepLink, parseConfig, readLegacyConfig, useCodingTools, validateTool } from './codingTools';

describe('coding tools config', () => {
  it('defaults to the six presets with a shortcut on the first', () => {
    const c = defaultConfig();
    expect(c.tools.map((t) => t.id)).toEqual(['claude-code', 'codex', 'codex-cli', 'cursor', 'opencode', 'pi']);
    expect(c.tools[0]?.shortcut).toBe(DEFAULT_TOOL_SHORTCUT);
    expect(c.tools.slice(1).every((t) => t.shortcut === undefined)).toBe(true);
    expect(STORAGE_KEY).toMatch(/\.v1$/);
  });
  it('survives garbage, wrong versions and bad entries', () => {
    expect(parseConfig('{not json')).toEqual(defaultConfig());
    expect(parseConfig(JSON.stringify({ version: 2, tools: [] }))).toEqual(defaultConfig());
    const parsed = parseConfig(JSON.stringify({ version: 1, tools: [{ id: 'x' }, { id: 'c', name: 'C', kind: 'command', template: 'c {prompt}', enabled: false }], instructions: 7 }));
    expect(parsed.tools[0]).toEqual({ id: 'c', name: 'C', kind: 'command', template: 'c {prompt}', enabled: false });
    expect(parsed.tools[1]?.preset).toBe('pi');
    expect(parsed.instructions).toBe('');
  });
  it('always uses the current preset template', () => {
    const stored = { version: 1, tools: [{ id: 'cursor', preset: 'cursor', name: 'Cursor', kind: 'command', template: 'evil', enabled: true }], instructions: 'hi' };
    const parsed = parseConfig(JSON.stringify(stored));
    expect(parsed.tools[0]?.template).toBe(PRESETS.cursor.template);
    expect(parsed.tools[0]?.kind).toBe('deeplink');
    expect(parsed.instructions).toBe('hi');
  });
  it('adds Pi to an existing configuration without changing the saved order or shortcuts', () => {
    const prior = defaultConfig().tools.filter((tool) => tool.preset !== 'pi').reverse();
    const parsed = parseConfig(JSON.stringify({ version: 1, tools: prior, instructions: 'mine' }));
    expect(parsed.tools.slice(0, prior.length)).toEqual(prior);
    expect(parsed.tools.at(-1)).toMatchObject({ id: 'pi', name: 'Pi', enabled: true });
    expect(parsed.instructions).toBe('mine');
  });
  it('validates custom tools', () => {
    expect(validateTool({ name: ' ', kind: 'command', template: 'x {prompt}' })).toBe('name');
    expect(validateTool({ name: 'A', kind: 'command', template: 'x' })).toBe('placeholder');
    expect(validateTool({ name: 'A', kind: 'deeplink', template: 'javascript:alert({prompt})' })).toBe('scheme');
    expect(validateTool({ name: 'A', kind: 'deeplink', template: 'myapp://new?p={prompt}' })).toBe('scheme');
    expect(isSafeDeepLink('DATA:text/html,{prompt}')).toBe(false);
    expect(isSafeDeepLink('https://x.example/{prompt}')).toBe(true);
    expect(isSafeDeepLink('http://x.example/{prompt}')).toBe(true);
    expect(isSafeDeepLink('codex://new?prompt={prompt}')).toBe(true);
    expect(isSafeDeepLink('cursor://anysphere.cursor-deeplink/prompt?text={prompt}')).toBe(true);
    expect(isSafeDeepLink('https:{prompt}')).toBe(false);
    expect(isSafeDeepLink('https://user:pass@example.com/?prompt={prompt}')).toBe(false);
    expect(isSafeDeepLink('https://example.com/a path?prompt={prompt}')).toBe(false);
    expect(isSafeDeepLink('no-scheme {prompt}')).toBe(false);
  });
  it('disables an old custom deep link with an unsupported scheme', () => {
    const old = { id: 'old', name: 'Old app', kind: 'deeplink', template: 'myapp://new?p={prompt}', enabled: true };
    expect(parseConfig(JSON.stringify({ version: 1, tools: [old], instructions: '' })).tools[0]).toEqual({ ...old, enabled: false });
  });
  it('hydrates each account from its own server value without displaying the prior account settings', () => {
    const first = { ...defaultConfig(), instructions: 'Private to account A' };
    useCodingTools.getState().hydrate('A', first);
    expect(useCodingTools.getState().instructions).toBe('Private to account A');
    useCodingTools.getState().setConfig({ tools: first.tools, instructions: 'Edited by A' });
    expect(useCodingTools.getState().revision).toBe(1);
    useCodingTools.getState().hydrate('B', defaultConfig());
    expect(useCodingTools.getState()).toMatchObject({ ownerId: 'B', instructions: '', revision: 0 });
  });
  it('keeps a shortcut bound to at most one tool', () => {
    const tools = defaultConfig().tools.map((t, i) => ({ ...t, shortcut: i < 3 ? DEFAULT_TOOL_SHORTCUT : undefined }));
    const deduped = dedupeShortcuts(tools);
    expect(deduped[0]?.shortcut).toBe(DEFAULT_TOOL_SHORTCUT);
    expect(deduped.slice(1).every((t) => t.shortcut === undefined)).toBe(true);
    // setConfig and hydrate run the same normalization.
    useCodingTools.getState().hydrate('A', { version: 1, tools, instructions: '' });
    expect(useCodingTools.getState().tools.filter((t) => t.shortcut).length).toBe(1);
  });
  it('reads the legacy browser value only for migration and removes it after save', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultConfig(), instructions: 'Migrate me' }));
    expect(readLegacyConfig()?.instructions).toBe('Migrate me');
    clearLegacyConfig();
    expect(readLegacyConfig()).toBeNull();
  });
});
