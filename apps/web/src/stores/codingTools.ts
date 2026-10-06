/**
 * Per-user coding tools for "Open in". The server owns settings; the versioned browser
 * value is read only once to migrate settings saved before server preferences existed.
 */
import { create } from 'zustand';

export type ToolKind = 'deeplink' | 'command';
export type PresetId = 'claude-code' | 'codex' | 'codex-cli' | 'cursor' | 'opencode' | 'pi';

export interface CodingTool {
  id: string;
  /** Set for built-in tools; their name and template come from the preset. */
  preset?: PresetId;
  name: string;
  kind: ToolKind;
  /** `{prompt}` (and optionally `{id}`, `{branch}`, `{url}`) are filled in at launch. */
  template: string;
  enabled: boolean;
  /** Optional binding such as `mod+alt+.`; the first enabled tool gets it by default. */
  shortcut?: string;
}

export interface CodingToolsConfig {
  version: 1;
  tools: CodingTool[];
  /** Appended to every prompt (Settings › Coding tools › Custom instructions). */
  instructions: string;
}

export const STORAGE_KEY = 'velocity.codingTools.v1';
export const DEFAULT_TOOL_SHORTCUT = 'mod+alt+.';
export const TEMPLATE_MAX = 2000;
export const INSTRUCTIONS_MAX = 4000;

/**
 * Presets. Launch methods were checked against each tool's official docs on 2026-10-05:
 *
 * - Claude Code: `claude "query"` starts an interactive session with an initial prompt.
 *   https://code.claude.com/docs/en/cli-reference ("CLI commands" table)
 * - Codex app: `codex://new?prompt=<text>` opens a new local chat with the composer
 *   prefilled ("Include at least one of prompt, path, or originUrl").
 *   https://learn.chatgpt.com/docs/reference/commands (formerly developers.openai.com/codex/app/commands)
 * - Codex CLI: `codex [PROMPT]` launches the terminal UI; PROMPT is "Optional text
 *   instruction to start the session".
 *   https://learn.chatgpt.com/docs/developer-commands?surface=cli (formerly developers.openai.com/codex/cli/reference)
 * - Cursor: `cursor://anysphere.cursor-deeplink/prompt?text=<text>`; "Deeplink URLs have
 *   a maximum length of 10,000 characters."
 *   https://cursor.com/docs/integrations/deeplinks
 * - opencode: the default TUI command takes `--prompt` ("Prompt to use"); `opencode run`
 *   is non-interactive, so the TUI form is used.
 *   https://opencode.ai/docs/cli/
 * - Pi: a positional message starts the interactive terminal UI with an initial prompt.
 *   https://pi.dev/docs/latest/cli ("Invocation and output")
 */
export const PRESETS: Record<PresetId, Omit<CodingTool, 'id' | 'enabled' | 'shortcut' | 'name'> & { maxUrl?: number }> = {
  'claude-code': { preset: 'claude-code', kind: 'command', template: 'claude {prompt}' },
  codex: { preset: 'codex', kind: 'deeplink', template: 'codex://new?prompt={prompt}', maxUrl: 8000 },
  'codex-cli': { preset: 'codex-cli', kind: 'command', template: 'codex {prompt}' },
  cursor: { preset: 'cursor', kind: 'deeplink', template: 'cursor://anysphere.cursor-deeplink/prompt?text={prompt}', maxUrl: 10000 },
  opencode: { preset: 'opencode', kind: 'command', template: 'opencode --prompt {prompt}' },
  pi: { preset: 'pi', kind: 'command', template: 'pi -- {prompt}' },
};

export const PRESET_ORDER: PresetId[] = ['claude-code', 'codex', 'codex-cli', 'cursor', 'opencode', 'pi'];

/** Names are product names (nominative use), kept out of the translated catalog. */
export const PRESET_NAMES: Record<PresetId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'codex-cli': 'Codex CLI',
  cursor: 'Cursor',
  opencode: 'opencode',
  pi: 'Pi',
};

export function defaultConfig(): CodingToolsConfig {
  return {
    version: 1,
    tools: PRESET_ORDER.map((p, i) => ({
      id: p,
      preset: p,
      kind: PRESETS[p].kind,
      template: PRESETS[p].template,
      name: PRESET_NAMES[p],
      enabled: true,
      ...(i === 0 ? { shortcut: DEFAULT_TOOL_SHORTCUT } : {}),
    })),
    instructions: '',
  };
}

function isTool(v: unknown): v is CodingTool {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    (t.kind === 'deeplink' || t.kind === 'command') &&
    typeof t.template === 'string' &&
    typeof t.enabled === 'boolean' &&
    (t.shortcut === undefined || typeof t.shortcut === 'string') &&
    (t.preset === undefined || (typeof t.preset === 'string' && t.preset in PRESETS))
  );
}

/**
 * A shortcut binding launches at most one tool. Keep the first tool that claims a binding and drop
 * it from any later duplicate, so reordering or adding tools can never leave two launch handlers
 * bound to the same key.
 */
export function dedupeShortcuts(tools: readonly CodingTool[]): CodingTool[] {
  const seen = new Set<string>();
  return tools.map((tool) => {
    if (!tool.shortcut) return tool;
    if (seen.has(tool.shortcut)) return withoutShortcut(tool);
    seen.add(tool.shortcut);
    return tool;
  });
}

function withoutShortcut(tool: CodingTool): CodingTool {
  const next = { ...tool };
  delete next.shortcut;
  return next;
}

/** Parse stored JSON; anything unexpected yields the defaults. */
export function parseConfig(raw: string | null): CodingToolsConfig {
  if (!raw) return defaultConfig();
  try {
    const v = JSON.parse(raw) as Partial<CodingToolsConfig> | null;
    if (!v || v.version !== 1 || !Array.isArray(v.tools)) return defaultConfig();
    const tools = v.tools.filter(isTool).map((t) => {
      // Presets always launch with the current, verified template.
      if (t.preset) return { ...t, kind: PRESETS[t.preset].kind, template: PRESETS[t.preset].template };
      // Keep an old custom tool editable, but never launch a scheme that is no
      // longer accepted by the form.
      return t.kind === 'deeplink' && !isSafeDeepLink(t.template) ? { ...t, enabled: false } : t;
    });
    // Existing v1 configurations predate Pi. Built-in tools cannot be removed in the UI,
    // so append the new preset without disturbing the user's order or shortcuts.
    if (!tools.some((t) => t.preset === 'pi')) {
      tools.push({ id: 'pi', preset: 'pi', name: PRESET_NAMES.pi, kind: PRESETS.pi.kind, template: PRESETS.pi.template, enabled: true });
    }
    return { version: 1, tools: dedupeShortcuts(tools), instructions: typeof v.instructions === 'string' ? v.instructions.slice(0, INSTRUCTIONS_MAX) : '' };
  } catch {
    return defaultConfig();
  }
}

export function readLegacyConfig(): CodingToolsConfig | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : parseConfig(raw);
  } catch {
    return null;
  }
}

export function clearLegacyConfig(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Browser storage can be unavailable; the server value is already saved.
  }
}

interface ToolsState extends CodingToolsConfig {
  ownerId: string | null;
  revision: number;
  hydrate: (ownerId: string, config: CodingToolsConfig, needsMigration?: boolean) => void;
  setConfig: (next: Omit<CodingToolsConfig, 'version'>) => void;
  reset: () => void;
}

export const useCodingTools = create<ToolsState>()((set) => ({
  ...defaultConfig(),
  ownerId: null,
  revision: 0,
  hydrate: (ownerId, config, needsMigration = false) =>
    set({ ...config, tools: dedupeShortcuts(config.tools), ownerId, revision: needsMigration ? 1 : 0 }),
  setConfig: (next) => {
    const config: CodingToolsConfig = { version: 1, tools: dedupeShortcuts(next.tools), instructions: next.instructions.slice(0, INSTRUCTIONS_MAX) };
    set((state) => ({ ...config, revision: state.revision + 1 }));
  },
  reset: () => {
    set((state) => ({ ...defaultConfig(), revision: state.revision + 1 }));
  },
}));

export function enabledTools(tools: readonly CodingTool[]): CodingTool[] {
  return tools.filter((t) => t.enabled && (t.kind !== 'deeplink' || isSafeDeepLink(t.template)));
}

/** Deep links may use web URLs or the app schemes supplied by built-in presets. */
export function isSafeDeepLink(template: string): boolean {
  try {
    const value = template.trim();
    if (!/^(?:https?|codex|cursor):\/\//i.test(value) || Array.from(value).some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return false;
    const url = new URL(value);
    return ['http:', 'https:', 'codex:', 'cursor:'].includes(url.protocol) && Boolean(url.host) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validateTool(t: Pick<CodingTool, 'name' | 'kind' | 'template'>): 'name' | 'template' | 'placeholder' | 'scheme' | null {
  if (!t.name.trim()) return 'name';
  if (!t.template.trim() || t.template.length > TEMPLATE_MAX) return 'template';
  if (!t.template.includes('{prompt}')) return 'placeholder';
  if (t.kind === 'deeplink' && !isSafeDeepLink(t.template)) return 'scheme';
  return null;
}

export function maxUrlFor(tool: CodingTool): number {
  return (tool.preset ? PRESETS[tool.preset].maxUrl : undefined) ?? 8000;
}
