import type { CodingToolPreference, UserPreferences } from '@velocity/schema';
import { validation } from '../errors';

const MAX_TOOLS = 25;
const MAX_TEMPLATE = 2_000;
const MAX_INSTRUCTIONS = 4_000;
const PRESETS = new Set(['claude-code', 'codex', 'codex-cli', 'cursor', 'opencode', 'pi']);
const PLACEHOLDER = '{prompt}';
const hasControl = (value: string): boolean => [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const hasUrlWhitespace = (value: string): boolean => [...value].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127);

const PRESET_IDS = PRESETS;
const hasOnlyKnownKeys = (value: object, keys: readonly string[]): boolean => Object.keys(value).every((k) => keys.includes(k));

/**
 * Parse a stored JSONB value defensively: settings are validated on write, so a value that fails
 * here means a hand-edited/legacy database. Returning null (no preferences yet) degrades the
 * viewer query instead of erroring its whole subtree.
 */
export function safeUserPreferences(value: unknown): UserPreferences | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!hasOnlyKnownKeys(v, ['codingTools', 'promptInstructions'])) return null;
  if (typeof v.promptInstructions !== 'string' || !Array.isArray(v.codingTools)) return null;
  const codingTools: CodingToolPreference[] = [];
  for (const item of v.codingTools) {
    if (!item || typeof item !== 'object') return null;
    const tool = item as Record<string, unknown>;
    if (!hasOnlyKnownKeys(tool, ['id', 'preset', 'name', 'kind', 'template', 'enabled', 'shortcut'])) return null;
    if (typeof tool.id !== 'string' || typeof tool.name !== 'string' || typeof tool.template !== 'string' || typeof tool.enabled !== 'boolean') return null;
    if (tool.kind !== 'command' && tool.kind !== 'deeplink') return null;
    if (tool.preset !== undefined && (typeof tool.preset !== 'string' || !PRESET_IDS.has(tool.preset))) return null;
    if (tool.shortcut !== undefined && typeof tool.shortcut !== 'string') return null;
    codingTools.push({
      id: tool.id,
      name: tool.name,
      kind: tool.kind,
      template: tool.template,
      enabled: tool.enabled,
      ...(tool.preset === undefined ? {} : { preset: tool.preset }),
      ...(tool.shortcut === undefined ? {} : { shortcut: tool.shortcut }),
    });
  }
  return { codingTools, promptInstructions: v.promptInstructions };
}

/** Validate client settings before storing them as a single per-user JSON value. */
export function validateUserPreferences(input: UserPreferences): UserPreferences {
  if (!input || !Array.isArray(input.codingTools) || input.codingTools.length > MAX_TOOLS) {
    throw validation(`Choose at most ${MAX_TOOLS} coding tools.`, { field: 'codingTools' });
  }
  if (typeof input.promptInstructions !== 'string' || input.promptInstructions.length > MAX_INSTRUCTIONS) {
    throw validation(`Custom instructions must be at most ${MAX_INSTRUCTIONS} characters.`, { field: 'promptInstructions' });
  }
  const ids = new Set<string>();
  const codingTools = input.codingTools.map((tool, index): CodingToolPreference => {
    const field = `codingTools.${index}`;
    if (!tool || typeof tool !== 'object') throw validation('Choose a valid coding tool.', { field });
    if (typeof tool.id !== 'string' || !tool.id.trim() || tool.id.length > 80 || hasControl(tool.id)) {
      throw validation('Tool ID must be 1–80 printable characters.', { field: `${field}.id` });
    }
    if (ids.has(tool.id)) throw validation('Tool IDs must be unique.', { field: `${field}.id` });
    ids.add(tool.id);
    if (typeof tool.name !== 'string' || !tool.name.trim() || tool.name.length > 80 || hasControl(tool.name)) {
      throw validation('Tool name must be 1–80 printable characters.', { field: `${field}.name` });
    }
    if (tool.kind !== 'command' && tool.kind !== 'deeplink') {
      throw validation('Choose a command or deep link.', { field: `${field}.kind` });
    }
    if (typeof tool.template !== 'string' || !tool.template.trim() || tool.template.length > MAX_TEMPLATE) {
      throw validation(`Tool template must be 1–${MAX_TEMPLATE} characters.`, { field: `${field}.template` });
    }
    if (!tool.template.includes(PLACEHOLDER)) {
      throw validation('Tool template must include {prompt}.', { field: `${field}.template` });
    }
    if (typeof tool.enabled !== 'boolean') throw validation('Tool enabled must be a boolean.', { field: `${field}.enabled` });
    if (tool.shortcut !== undefined && (typeof tool.shortcut !== 'string' || tool.shortcut.length > 64 || hasControl(tool.shortcut))) {
      throw validation('Tool shortcut must be at most 64 printable characters.', { field: `${field}.shortcut` });
    }
    if (tool.preset !== undefined && (!PRESETS.has(tool.preset) || tool.id !== tool.preset)) {
      throw validation('Choose a known tool preset.', { field: `${field}.preset` });
    }
    if (tool.kind === 'deeplink') {
      // App schemes are explicit so stored settings cannot become script-capable links.
      const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(tool.template)?.[1]?.toLowerCase();
      if (!scheme || !['http', 'https', 'codex', 'cursor'].includes(scheme) || hasUrlWhitespace(tool.template)) {
        throw validation('Deep links must use http(s), codex, or cursor.', { field: `${field}.template` });
      }
      try {
        const parsed = new URL(tool.template.replaceAll(/\{(?:prompt|id|branch|url)\}/g, 'value'));
        if (!parsed.hostname || parsed.username || parsed.password) throw new Error('Invalid host');
      } catch {
        throw validation('Choose a valid deep-link URL.', { field: `${field}.template` });
      }
    }
    return {
      id: tool.id,
      name: tool.name.trim(),
      kind: tool.kind,
      template: tool.template,
      enabled: tool.enabled,
      ...(tool.preset === undefined ? {} : { preset: tool.preset }),
      ...(tool.shortcut === undefined ? {} : { shortcut: tool.shortcut }),
    };
  });
  return { codingTools, promptInstructions: input.promptInstructions };
}
