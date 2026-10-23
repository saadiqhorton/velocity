import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { engine } from '@/keyboard/react';
import { shortcutKeys, useShortcutKeys } from './shortcutKeys';

const cleanups: Array<() => void> = [];

function register(id: string, keys: string[]) {
  cleanups.push(engine.register([{ id, title: id, group: 'general', keys, run: () => undefined }]));
}

afterEach(() => {
  for (const off of cleanups.splice(0)) off();
});

describe('shortcutKeys', () => {
  it('returns the key caps of the first binding, read from the registry', () => {
    register('test.create', ['c']);
    expect(shortcutKeys('test.create')).toEqual(['C']);
  });

  it('expands modifiers and chords into key caps', () => {
    register('test.palette', ['mod+k']);
    register('test.settings', ['g s']);
    // jsdom has no Apple platform, so mod renders as Ctrl.
    expect(shortcutKeys('test.palette')).toEqual(['Ctrl', 'K']);
    expect(shortcutKeys('test.settings')).toEqual(['G', 'S']);
  });

  it('is undefined for an unknown or unbound command', () => {
    register('test.unbound', []);
    expect(shortcutKeys('test.missing')).toBeUndefined();
    expect(shortcutKeys('test.unbound')).toBeUndefined();
  });
});

describe('useShortcutKeys', () => {
  it('updates once the command registers, so a late command still shows its hint', () => {
    const { result } = renderHook(() => useShortcutKeys('test.late'));
    expect(result.current).toBeUndefined();
    act(() => {
      register('test.late', ['/']);
    });
    expect(result.current).toEqual(['/']);
  });
});
