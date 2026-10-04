/**
 * Keyboard engine (SPEC §4.12, §5.4): one global listener, layered scopes
 * (field → modal → panel | list → global), a declarative chord registry (`g b`),
 * and a command registry that also feeds the command palette (§4.13).
 *
 * Pure TypeScript: React bindings live in ./react.tsx.
 */

export type Scope = 'global' | 'list' | 'panel';
export type Region = 'sidebar' | 'list' | 'panel' | 'other';

export type CommandGroup = 'general' | 'navigation' | 'list' | 'issue' | 'selection';

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** Alternative bindings. Chords are space separated: `g b`. Modifiers: mod (⌘/Ctrl), alt, shift. */
  keys?: string[];
  /** Which layer the command belongs to. Defaults to global. */
  scope?: Scope;
  /** Enabled predicate, evaluated at key time and when listing for the palette. */
  when?: () => boolean;
  run: () => void;
  /** Fire even while a text field has focus (e.g. mod+k). */
  allowInInput?: boolean;
  /** Fire while a modal dialog is open. */
  allowInModal?: boolean;
  /** Fire on auto-repeat (held key), e.g. j/k. */
  repeat?: boolean;
  /** Hide from the palette (still listed in the shortcuts help). */
  palette?: boolean;
  /** Extra palette search terms. */
  keywords?: string[];
}

export interface KeyLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
}

const NAMED: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
  return: 'enter',
};

function isLetter(k: string): boolean {
  return k.length === 1 && /[a-z]/i.test(k);
}

/** Normalize a key event into a binding token: `[mod+][alt+][shift+]key`. */
export function eventToToken(e: KeyLike): string {
  let key = e.key;
  if (key === 'Dead' || key === 'Unidentified') key = '';
  // Alt+letter yields a symbol on macOS (alt+a = å); recover the physical letter.
  if (e.altKey && e.code && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  if (e.altKey && e.code && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  let k = key.length === 1 ? key : key.toLowerCase();
  k = NAMED[k] ?? k;
  if (isLetter(k)) k = k.toLowerCase();
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  // Shift matters for letters and named keys; for symbols (?, #, >) it is implied by the key.
  if (e.shiftKey && (isLetter(k) || k.length > 1)) parts.push('shift');
  parts.push(k);
  return parts.join('+');
}

/** Normalize a binding written by hand (`Mod+K`, `shift+X`, `?`) to the token form. */
export function normalizeBinding(binding: string): string {
  return binding
    .trim()
    .split(/\s+/)
    .map((step) => {
      const raw = step.split('+').filter(Boolean);
      const mods = new Set<string>();
      let key = '';
      for (const r of raw) {
        const l = r.toLowerCase();
        if (l === 'mod' || l === 'cmd' || l === 'ctrl' || l === 'meta') mods.add('mod');
        else if (l === 'alt' || l === 'option' || l === 'opt') mods.add('alt');
        else if (l === 'shift') mods.add('shift');
        else key = NAMED[l] ?? (r.length === 1 && !isLetter(r) ? r : l);
      }
      if (step.endsWith('++')) key = '+';
      const parts: string[] = [];
      if (mods.has('mod')) parts.push('mod');
      if (mods.has('alt')) parts.push('alt');
      if (mods.has('shift') && (isLetter(key) || key.length > 1)) parts.push('shift');
      parts.push(key);
      return parts.join('+');
    })
    .join(' ');
}

export function isTextInput(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return false;
}

export interface EngineContext {
  /** True while a modal dialog (aria-modal) is open. */
  modalOpen: () => boolean;
  /** Region of the shell that currently owns focus. */
  region: () => Region;
  /** True when focus sits in a component that handles its own keys (listbox, menu). */
  ownsKeys: (target: EventTarget | null) => boolean;
}

const CHORD_TIMEOUT_MS = 1200;

export class KeyboardEngine {
  private commands = new Map<string, Command>();
  private pending: string | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(private ctx: EngineContext) {}

  setContext(ctx: EngineContext): void {
    this.ctx = ctx;
  }

  register(commands: Command[]): () => void {
    for (const c of commands) this.commands.set(c.id, c);
    this.changed();
    return () => {
      let removed = false;
      for (const c of commands) {
        if (this.commands.get(c.id) === c) {
          this.commands.delete(c.id);
          removed = true;
        }
      }
      if (removed) this.changed();
    };
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  /** Every registered command, enabled or not. */
  all(): Command[] {
    return [...this.commands.values()];
  }

  /** Commands for the palette: enabled and not hidden. */
  available(): Command[] {
    return this.all().filter((c) => c.palette !== false && (c.when?.() ?? true));
  }

  run(id: string): boolean {
    const c = this.commands.get(id);
    if (!c || !(c.when?.() ?? true)) return false;
    c.run();
    return true;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getVersion(): number {
    return this.version;
  }

  /** Pending chord prefix (for an on-screen hint), e.g. "g". */
  pendingChord(): string | null {
    return this.pending;
  }

  private changed(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  private scopeChain(): Scope[] {
    const region = this.ctx.region();
    if (region === 'panel') return ['panel', 'global'];
    if (region === 'list') return ['list', 'global'];
    // Sidebar/other: list commands still apply to the active list (Linear parity: J/K work everywhere).
    return ['list', 'global'];
  }

  private find(token: string, inInput: boolean, inModal: boolean, repeat: boolean): Command | undefined {
    const chain = this.scopeChain();
    for (const scope of chain) {
      for (const c of this.commands.values()) {
        if ((c.scope ?? 'global') !== scope) continue;
        if (!c.keys?.some((k) => normalizeBinding(k) === token)) continue;
        if (inInput && !c.allowInInput) continue;
        if (inModal && !c.allowInModal) continue;
        if (repeat && !c.repeat) continue;
        if (!(c.when?.() ?? true)) continue;
        return c;
      }
    }
    return undefined;
  }

  private isChordPrefix(token: string, inInput: boolean, inModal: boolean): boolean {
    if (inInput) return false;
    const prefix = `${token} `;
    for (const c of this.commands.values()) {
      if (inModal && !c.allowInModal) continue;
      if (c.keys?.some((k) => normalizeBinding(k).startsWith(prefix)) && (c.when?.() ?? true)) return true;
    }
    return false;
  }

  private clearPending(): void {
    this.pending = null;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.changed();
  }

  /** Returns true when the event was consumed. */
  handle(e: KeyLike & { target?: EventTarget | null; preventDefault?: () => void }): boolean {
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt') return false;
    const target = e.target ?? null;
    if (this.ctx.ownsKeys(target)) return false;
    const inInput = isTextInput(target);
    const inModal = this.ctx.modalOpen();
    const token = eventToToken(e);

    if (this.pending) {
      const chord = `${this.pending} ${token}`;
      this.clearPending();
      const c = this.find(chord, inInput, inModal, false);
      if (c) {
        e.preventDefault?.();
        c.run();
        return true;
      }
      return false;
    }

    const c = this.find(token, inInput, inModal, Boolean(e.repeat));
    if (c) {
      e.preventDefault?.();
      c.run();
      return true;
    }
    if (!e.repeat && this.isChordPrefix(token, inInput, inModal)) {
      e.preventDefault?.();
      this.pending = token;
      this.pendingTimer = setTimeout(() => this.clearPending(), CHORD_TIMEOUT_MS);
      this.changed();
      return true;
    }
    return false;
  }
}

/** Human-readable key caps for a binding, per platform (⌘ on macOS, Ctrl elsewhere). */
export function formatBinding(binding: string, mac: boolean): string[][] {
  return normalizeBinding(binding)
    .split(' ')
    .map((step) =>
      step.split('+').map((part) => {
        switch (part) {
          case 'mod':
            return mac ? '⌘' : 'Ctrl';
          case 'alt':
            return mac ? '⌥' : 'Alt';
          case 'shift':
            return '⇧';
          case 'arrowup':
            return '↑';
          case 'arrowdown':
            return '↓';
          case 'arrowleft':
            return '←';
          case 'arrowright':
            return '→';
          case 'enter':
            return 'Enter';
          case 'escape':
            return 'Esc';
          case 'space':
            return 'Space';
          case 'tab':
            return 'Tab';
          default:
            return part.length === 1 ? part.toUpperCase() : part;
        }
      }),
    );
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad/i.test(p ?? '');
}
