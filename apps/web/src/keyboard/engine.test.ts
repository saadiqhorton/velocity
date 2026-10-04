import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardEngine, eventToToken, formatBinding, isTextInput, normalizeBinding } from './engine';
import type { Command, EngineContext, Region } from './engine';

interface Ctl {
  modal: boolean;
  region: Region;
  owns: boolean;
}

function setup(): { engine: KeyboardEngine; ctl: Ctl } {
  const ctl: Ctl = { modal: false, region: 'list', owns: false };
  const ctx: EngineContext = {
    modalOpen: () => ctl.modal,
    region: () => ctl.region,
    ownsKeys: () => ctl.owns,
  };
  return { engine: new KeyboardEngine(ctx), ctl };
}

function cmd(id: string, keys: string[], extra: Partial<Command> = {}): Command & { run: ReturnType<typeof vi.fn> } {
  return { id, title: id, group: 'general', keys, run: vi.fn(), ...extra } as Command & { run: ReturnType<typeof vi.fn> };
}

const body = (): HTMLElement => document.createElement('div');

describe('eventToToken', () => {
  it('lowercases letters', () => {
    expect(eventToToken({ key: 'J' })).toBe('j');
    expect(eventToToken({ key: 'j' })).toBe('j');
  });
  it('adds shift for letters and named keys', () => {
    expect(eventToToken({ key: 'J', shiftKey: true })).toBe('shift+j');
    expect(eventToToken({ key: 'ArrowDown', shiftKey: true })).toBe('shift+arrowdown');
  });
  it('omits shift for symbols', () => {
    expect(eventToToken({ key: '?', shiftKey: true })).toBe('?');
    expect(eventToToken({ key: '#', shiftKey: true })).toBe('#');
  });
  it('maps meta and ctrl to mod', () => {
    expect(eventToToken({ key: 'k', metaKey: true })).toBe('mod+k');
    expect(eventToToken({ key: 'k', ctrlKey: true })).toBe('mod+k');
    expect(eventToToken({ key: 'K', ctrlKey: true, shiftKey: true })).toBe('mod+shift+k');
  });
  it('normalizes named keys', () => {
    expect(eventToToken({ key: ' ' })).toBe('space');
    expect(eventToToken({ key: 'Esc' })).toBe('escape');
    expect(eventToToken({ key: 'Escape' })).toBe('escape');
    expect(eventToToken({ key: 'Enter' })).toBe('enter');
  });
  it('recovers the physical key for alt combinations', () => {
    expect(eventToToken({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })).toBe('alt+arrowup');
    expect(eventToToken({ key: 'å', code: 'KeyA', altKey: true })).toBe('alt+a');
    expect(eventToToken({ key: '¡', code: 'Digit1', altKey: true })).toBe('alt+1');
  });
  it('does not use code without alt', () => {
    expect(eventToToken({ key: 'q', code: 'KeyA' })).toBe('q');
  });
  it('handles dead keys', () => {
    expect(eventToToken({ key: 'Dead' })).toBe('');
  });
});

describe('normalizeBinding', () => {
  it('normalizes modifiers and case', () => {
    expect(normalizeBinding('Mod+K')).toBe('mod+k');
    expect(normalizeBinding('cmd+k')).toBe('mod+k');
    expect(normalizeBinding('Ctrl+Shift+P')).toBe('mod+shift+p');
    expect(normalizeBinding('option+ArrowUp')).toBe('alt+arrowup');
  });
  it('orders modifiers mod, alt, shift', () => {
    expect(normalizeBinding('shift+alt+mod+x')).toBe('mod+alt+shift+x');
  });
  it('keeps symbols and drops shift for them', () => {
    expect(normalizeBinding('?')).toBe('?');
    expect(normalizeBinding('shift+?')).toBe('?');
    expect(normalizeBinding('#')).toBe('#');
  });
  it('normalizes chords', () => {
    expect(normalizeBinding('G B')).toBe('g b');
    expect(normalizeBinding('g  shift+b')).toBe('g shift+b');
  });
  it('maps aliases', () => {
    expect(normalizeBinding('Esc')).toBe('escape');
    expect(normalizeBinding('up')).toBe('arrowup');
    expect(normalizeBinding('Return')).toBe('enter');
  });
  it('supports the plus key', () => {
    expect(normalizeBinding('mod++')).toBe('mod++');
  });
  it('agrees with eventToToken for matching input', () => {
    expect(normalizeBinding('Shift+J')).toBe(eventToToken({ key: 'J', shiftKey: true }));
    expect(normalizeBinding('mod+Enter')).toBe(eventToToken({ key: 'Enter', metaKey: true }));
  });
});

describe('formatBinding', () => {
  it('formats for mac and others', () => {
    expect(formatBinding('mod+k', true)).toEqual([['⌘', 'K']]);
    expect(formatBinding('mod+k', false)).toEqual([['Ctrl', 'K']]);
    expect(formatBinding('alt+shift+arrowup', true)).toEqual([['⌥', '⇧', '↑']]);
    expect(formatBinding('alt+x', false)).toEqual([['Alt', 'X']]);
  });
  it('formats chords as separate steps', () => {
    expect(formatBinding('g b', false)).toEqual([['G'], ['B']]);
  });
  it('names special keys', () => {
    expect(formatBinding('escape', false)).toEqual([['Esc']]);
    expect(formatBinding('space', false)).toEqual([['Space']]);
    expect(formatBinding('enter', false)).toEqual([['Enter']]);
    expect(formatBinding('?', false)).toEqual([['?']]);
  });
});

describe('isTextInput', () => {
  it('detects text fields', () => {
    expect(isTextInput(document.createElement('textarea'))).toBe(true);
    expect(isTextInput(document.createElement('select'))).toBe(true);
    const text = document.createElement('input');
    expect(isTextInput(text)).toBe(true);
    text.type = 'search';
    expect(isTextInput(text)).toBe(true);
  });
  it('ignores non-text inputs', () => {
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file', 'reset']) {
      const el = document.createElement('input');
      el.type = type;
      expect(isTextInput(el), type).toBe(false);
    }
  });
  it('detects contenteditable', () => {
    const el = document.createElement('div');
    // jsdom does not implement isContentEditable; emulate the browser property.
    Object.defineProperty(el, 'isContentEditable', { value: true });
    expect(isTextInput(el)).toBe(true);
  });
  it('is false for other elements and null', () => {
    expect(isTextInput(document.createElement('div'))).toBe(false);
    expect(isTextInput(document.createElement('button'))).toBe(false);
    expect(isTextInput(null)).toBe(false);
    expect(isTextInput(window)).toBe(false);
  });
});

describe('KeyboardEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('dispatch', () => {
    it('runs a matching command, prevents default and returns true', () => {
      const { engine } = setup();
      const c = cmd('a', ['j']);
      engine.register([c]);
      const preventDefault = vi.fn();
      expect(engine.handle({ key: 'j', target: body(), preventDefault })).toBe(true);
      expect(c.run).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalled();
    });
    it('returns false for unbound keys and ignores bare modifier keys', () => {
      const { engine } = setup();
      const c = cmd('a', ['j']);
      engine.register([c]);
      expect(engine.handle({ key: 'x', target: body() })).toBe(false);
      for (const key of ['Shift', 'Control', 'Meta', 'Alt']) expect(engine.handle({ key })).toBe(false);
      expect(c.run).not.toHaveBeenCalled();
    });
    it('matches alt, mod and shift bindings', () => {
      const { engine } = setup();
      const a = cmd('alt', ['alt+arrowup']);
      const b = cmd('mod', ['mod+k'], { allowInInput: true });
      const c = cmd('shift', ['shift+j']);
      engine.register([a, b, c]);
      engine.handle({ key: 'ArrowUp', code: 'ArrowUp', altKey: true, target: body() });
      engine.handle({ key: 'k', ctrlKey: true, target: body() });
      engine.handle({ key: 'J', shiftKey: true, target: body() });
      expect(a.run).toHaveBeenCalled();
      expect(b.run).toHaveBeenCalled();
      expect(c.run).toHaveBeenCalled();
    });
    it('matches ? without shift in the binding', () => {
      const { engine } = setup();
      const c = cmd('help', ['?']);
      engine.register([c]);
      expect(engine.handle({ key: '?', shiftKey: true, target: body() })).toBe(true);
      expect(c.run).toHaveBeenCalled();
    });
    it('works without a target', () => {
      const { engine } = setup();
      const c = cmd('a', ['j']);
      engine.register([c]);
      expect(engine.handle({ key: 'j' })).toBe(true);
    });
  });

  describe('scope layering', () => {
    function twoScopes() {
      const { engine, ctl } = setup();
      const list = cmd('list', ['x'], { scope: 'list' });
      const global = cmd('global', ['x']);
      const panel = cmd('panel', ['x'], { scope: 'panel' });
      engine.register([global, list]);
      return { engine, ctl, list, global, panel };
    }
    it.each<Region>(['list', 'sidebar', 'other'])('list wins over global in region %s', (region) => {
      const { engine, ctl, list, global } = twoScopes();
      ctl.region = region;
      engine.handle({ key: 'x', target: body() });
      expect(list.run).toHaveBeenCalledTimes(1);
      expect(global.run).not.toHaveBeenCalled();
    });
    it('panel wins over global when region is panel and list commands are skipped', () => {
      const { engine, ctl, list, global, panel } = twoScopes();
      engine.register([panel]);
      ctl.region = 'panel';
      engine.handle({ key: 'x', target: body() });
      expect(panel.run).toHaveBeenCalledTimes(1);
      expect(list.run).not.toHaveBeenCalled();
      expect(global.run).not.toHaveBeenCalled();
    });
    it('in the panel region a list command does not fire but global does', () => {
      const { engine, ctl, list, global } = twoScopes();
      ctl.region = 'panel';
      engine.handle({ key: 'x', target: body() });
      expect(list.run).not.toHaveBeenCalled();
      expect(global.run).toHaveBeenCalledTimes(1);
    });
    it('panel commands do not fire in list region', () => {
      const { engine, ctl } = setup();
      const panel = cmd('panel', ['x'], { scope: 'panel' });
      engine.register([panel]);
      ctl.region = 'list';
      expect(engine.handle({ key: 'x', target: body() })).toBe(false);
    });
    it('falls through to the next scope when the higher one is disabled', () => {
      const { engine } = setup();
      const list = cmd('list', ['x'], { scope: 'list', when: () => false });
      const global = cmd('global', ['x']);
      engine.register([list, global]);
      engine.handle({ key: 'x', target: body() });
      expect(list.run).not.toHaveBeenCalled();
      expect(global.run).toHaveBeenCalled();
    });
  });

  describe('when', () => {
    it('is evaluated at key time', () => {
      const { engine } = setup();
      let on = false;
      const c = cmd('a', ['j'], { when: () => on });
      engine.register([c]);
      expect(engine.handle({ key: 'j', target: body() })).toBe(false);
      on = true;
      expect(engine.handle({ key: 'j', target: body() })).toBe(true);
      expect(c.run).toHaveBeenCalledTimes(1);
    });
  });

  describe('text inputs', () => {
    it('blocks commands in inputs, textarea and contenteditable unless allowInInput', () => {
      const { engine } = setup();
      const blocked = cmd('blocked', ['j']);
      const allowed = cmd('allowed', ['mod+k'], { allowInInput: true });
      engine.register([blocked, allowed]);
      const input = document.createElement('input');
      const area = document.createElement('textarea');
      const ce = document.createElement('div');
      Object.defineProperty(ce, 'isContentEditable', { value: true });
      for (const target of [input, area, ce]) {
        expect(engine.handle({ key: 'j', target })).toBe(false);
        expect(engine.handle({ key: 'k', metaKey: true, target })).toBe(true);
      }
      expect(blocked.run).not.toHaveBeenCalled();
      expect(allowed.run).toHaveBeenCalledTimes(3);
    });
    it('still fires on checkboxes', () => {
      const { engine } = setup();
      const c = cmd('a', ['j']);
      engine.register([c]);
      const box = document.createElement('input');
      box.type = 'checkbox';
      expect(engine.handle({ key: 'j', target: box })).toBe(true);
    });
    it('does not start chords inside text inputs', () => {
      const { engine } = setup();
      engine.register([cmd('b', ['g b'])]);
      expect(engine.handle({ key: 'g', target: document.createElement('input') })).toBe(false);
      expect(engine.pendingChord()).toBeNull();
    });
  });

  describe('modal', () => {
    it('blocks commands while a modal is open unless allowInModal', () => {
      const { engine, ctl } = setup();
      const blocked = cmd('blocked', ['j']);
      const allowed = cmd('allowed', ['escape'], { allowInModal: true });
      engine.register([blocked, allowed]);
      ctl.modal = true;
      expect(engine.handle({ key: 'j', target: body() })).toBe(false);
      expect(engine.handle({ key: 'Escape', target: body() })).toBe(true);
      ctl.modal = false;
      expect(engine.handle({ key: 'j', target: body() })).toBe(true);
    });
    it('does not start a chord whose commands are not allowed in modals', () => {
      const { engine, ctl } = setup();
      engine.register([cmd('b', ['g b'])]);
      ctl.modal = true;
      expect(engine.handle({ key: 'g', target: body() })).toBe(false);
      expect(engine.pendingChord()).toBeNull();
    });
  });

  describe('repeat', () => {
    it('ignores auto-repeat unless the command opts in', () => {
      const { engine } = setup();
      const once = cmd('once', ['x']);
      const held = cmd('held', ['j'], { repeat: true });
      engine.register([once, held]);
      expect(engine.handle({ key: 'x', repeat: true, target: body() })).toBe(false);
      expect(engine.handle({ key: 'j', repeat: true, target: body() })).toBe(true);
      expect(once.run).not.toHaveBeenCalled();
      expect(held.run).toHaveBeenCalled();
    });
    it('does not start a chord on repeat', () => {
      const { engine } = setup();
      engine.register([cmd('b', ['g b'])]);
      expect(engine.handle({ key: 'g', repeat: true, target: body() })).toBe(false);
      expect(engine.pendingChord()).toBeNull();
    });
  });

  describe('ownsKeys', () => {
    it('returns false without consuming when the focused component owns keys', () => {
      const { engine, ctl } = setup();
      const c = cmd('a', ['j']);
      engine.register([c]);
      ctl.owns = true;
      const preventDefault = vi.fn();
      expect(engine.handle({ key: 'j', target: body(), preventDefault })).toBe(false);
      expect(c.run).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
    });
    it('receives the event target', () => {
      const ownsKeys = vi.fn(() => false);
      const engine = new KeyboardEngine({ modalOpen: () => false, region: () => 'list', ownsKeys });
      const target = body();
      engine.handle({ key: 'j', target });
      expect(ownsKeys).toHaveBeenCalledWith(target);
    });
    it('setContext swaps the context', () => {
      const { engine } = setup();
      const c = cmd('a', ['j']);
      engine.register([c]);
      engine.setContext({ modalOpen: () => true, region: () => 'list', ownsKeys: () => false });
      expect(engine.handle({ key: 'j', target: body() })).toBe(false);
    });
  });

  describe('chords', () => {
    it('fires on g then b; the prefix is consumed', () => {
      const { engine } = setup();
      const c = cmd('inbox', ['g b']);
      engine.register([c]);
      const pd = vi.fn();
      expect(engine.handle({ key: 'g', target: body(), preventDefault: pd })).toBe(true);
      expect(pd).toHaveBeenCalled();
      expect(engine.pendingChord()).toBe('g');
      expect(c.run).not.toHaveBeenCalled();
      expect(engine.handle({ key: 'b', target: body() })).toBe(true);
      expect(c.run).toHaveBeenCalledTimes(1);
      expect(engine.pendingChord()).toBeNull();
    });
    it('an unknown second key clears pending and returns false', () => {
      const { engine } = setup();
      const c = cmd('inbox', ['g b']);
      const other = cmd('other', ['z']);
      engine.register([c, other]);
      engine.handle({ key: 'g', target: body() });
      expect(engine.handle({ key: 'z', target: body() })).toBe(false);
      expect(engine.pendingChord()).toBeNull();
      expect(other.run).not.toHaveBeenCalled();
      expect(c.run).not.toHaveBeenCalled();
    });
    it('after clearing, normal keys work again', () => {
      const { engine } = setup();
      const other = cmd('other', ['z']);
      engine.register([cmd('inbox', ['g b']), other]);
      engine.handle({ key: 'g', target: body() });
      engine.handle({ key: 'q', target: body() });
      expect(engine.handle({ key: 'z', target: body() })).toBe(true);
    });
    it('clears pending after 1200ms', () => {
      const { engine } = setup();
      const c = cmd('inbox', ['g b']);
      engine.register([c]);
      engine.handle({ key: 'g', target: body() });
      vi.advanceTimersByTime(1199);
      expect(engine.pendingChord()).toBe('g');
      vi.advanceTimersByTime(2);
      expect(engine.pendingChord()).toBeNull();
      expect(engine.handle({ key: 'b', target: body() })).toBe(false);
      expect(c.run).not.toHaveBeenCalled();
    });
    it('completing the chord before the timeout cancels the timer', () => {
      const { engine } = setup();
      engine.register([cmd('inbox', ['g b'])]);
      engine.handle({ key: 'g', target: body() });
      engine.handle({ key: 'b', target: body() });
      const v = engine.getVersion();
      vi.advanceTimersByTime(5000);
      expect(engine.getVersion()).toBe(v);
    });
    it('a direct binding for the prefix key wins over starting a chord', () => {
      const { engine } = setup();
      const direct = cmd('direct', ['g']);
      engine.register([direct, cmd('inbox', ['g b'])]);
      expect(engine.handle({ key: 'g', target: body() })).toBe(true);
      expect(direct.run).toHaveBeenCalled();
      expect(engine.pendingChord()).toBeNull();
    });
    it('does not start a chord when every chord command is disabled', () => {
      const { engine } = setup();
      engine.register([cmd('inbox', ['g b'], { when: () => false })]);
      expect(engine.handle({ key: 'g', target: body() })).toBe(false);
    });
    it('supports modified second steps', () => {
      const { engine } = setup();
      const c = cmd('x', ['g shift+b']);
      engine.register([c]);
      engine.handle({ key: 'g', target: body() });
      engine.handle({ key: 'B', shiftKey: true, target: body() });
      expect(c.run).toHaveBeenCalled();
    });
    it('chord respects scope layering', () => {
      const { engine, ctl } = setup();
      const list = cmd('list', ['g b'], { scope: 'list' });
      const global = cmd('global', ['g b']);
      engine.register([global, list]);
      ctl.region = 'panel';
      engine.handle({ key: 'g', target: body() });
      engine.handle({ key: 'b', target: body() });
      expect(global.run).toHaveBeenCalled();
      expect(list.run).not.toHaveBeenCalled();
    });
  });

  describe('registry', () => {
    it('register returns an unregister that removes only its own commands', () => {
      const { engine } = setup();
      const a1 = cmd('a', ['j']);
      const a2 = cmd('a', ['k']);
      const un1 = engine.register([a1]);
      engine.register([a2]); // replaces id "a"
      un1(); // stale: must not remove a2
      expect(engine.get('a')).toBe(a2);
      expect(engine.handle({ key: 'k', target: body() })).toBe(true);
    });
    it('unregister removes commands and stops dispatch', () => {
      const { engine } = setup();
      const c = cmd('a', ['j']);
      const un = engine.register([c]);
      un();
      expect(engine.get('a')).toBeUndefined();
      expect(engine.handle({ key: 'j', target: body() })).toBe(false);
    });
    it('a stale unregister does not notify', () => {
      const { engine } = setup();
      const un = engine.register([cmd('a', ['j'])]);
      un();
      const listener = vi.fn();
      engine.subscribe(listener);
      un();
      expect(listener).not.toHaveBeenCalled();
    });
    it('all() includes disabled commands; available() hides palette:false and disabled', () => {
      const { engine } = setup();
      engine.register([
        cmd('visible', ['a']),
        cmd('hidden', ['b'], { palette: false }),
        cmd('disabled', ['c'], { when: () => false }),
        cmd('explicit', ['d'], { palette: true }),
      ]);
      expect(engine.all().map((c) => c.id)).toEqual(['visible', 'hidden', 'disabled', 'explicit']);
      expect(engine.available().map((c) => c.id)).toEqual(['visible', 'explicit']);
    });
    it('run(id) runs enabled commands only', () => {
      const { engine } = setup();
      const ok = cmd('ok', []);
      const off = cmd('off', [], { when: () => false });
      engine.register([ok, off]);
      expect(engine.run('ok')).toBe(true);
      expect(ok.run).toHaveBeenCalledTimes(1);
      expect(engine.run('off')).toBe(false);
      expect(off.run).not.toHaveBeenCalled();
      expect(engine.run('missing')).toBe(false);
    });
    it('commands without keys are never matched', () => {
      const { engine } = setup();
      engine.register([cmd('nokeys', [])]);
      expect(engine.handle({ key: 'a', target: body() })).toBe(false);
    });
    it('alternative bindings all work', () => {
      const { engine } = setup();
      const c = cmd('a', ['j', 'ArrowDown']);
      engine.register([c]);
      engine.handle({ key: 'j', target: body() });
      engine.handle({ key: 'ArrowDown', target: body() });
      expect(c.run).toHaveBeenCalledTimes(2);
    });
  });

  describe('subscribe and version', () => {
    it('bumps version and notifies on register/unregister', () => {
      const { engine } = setup();
      const listener = vi.fn();
      const unsub = engine.subscribe(listener);
      const v0 = engine.getVersion();
      const un = engine.register([cmd('a', ['j'])]);
      expect(engine.getVersion()).toBe(v0 + 1);
      expect(listener).toHaveBeenCalledTimes(1);
      un();
      expect(engine.getVersion()).toBe(v0 + 2);
      expect(listener).toHaveBeenCalledTimes(2);
      unsub();
      engine.register([cmd('b', ['k'])]);
      expect(listener).toHaveBeenCalledTimes(2);
    });
    it('notifies when a chord starts and clears', () => {
      const { engine } = setup();
      engine.register([cmd('inbox', ['g b'])]);
      const listener = vi.fn();
      engine.subscribe(listener);
      engine.handle({ key: 'g', target: body() });
      expect(listener).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1300);
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });
});
