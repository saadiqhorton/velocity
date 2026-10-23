import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_UNDO_ENTRIES, forgetUndo, latestUndo, pushUndo, resetUndo, undoDepth, useRunUndo } from './undo';
import type { UndoEntry } from './undo';

const showFlag = vi.hoisted(() => vi.fn<(flag: unknown) => string>(() => 'flag-1'));

vi.mock('@velocity/ui', async (orig) => ({
  ...(await orig<typeof import('@velocity/ui')>()),
  useFlags: () => ({ showFlag, dismissFlag: vi.fn() }),
}));

function entry(label: string, ok = true) {
  return { label, undo: vi.fn(async () => ok) } satisfies UndoEntry;
}

beforeEach(() => {
  resetUndo();
  showFlag.mockClear();
});

describe('undo stack', () => {
  it('is LIFO: the newest entry is undone first', () => {
    const a = entry('a');
    const b = entry('b');
    pushUndo(a);
    pushUndo(b);
    expect(undoDepth()).toBe(2);
    expect(latestUndo()).toBe(b);
    forgetUndo(b);
    expect(latestUndo()).toBe(a);
  });

  it('is bounded: past 20 entries the oldest falls off', () => {
    expect(MAX_UNDO_ENTRIES).toBe(20);
    const all = Array.from({ length: 25 }, (_, i) => entry(`e${i}`));
    for (const e of all) pushUndo(e);
    expect(undoDepth()).toBe(20);
    // Walk back from the newest: the five oldest (e0..e4) were dropped.
    for (let i = 24; i >= 5; i--) {
      expect(latestUndo()).toBe(all[i]);
      forgetUndo(all[i] as UndoEntry);
    }
    expect(latestUndo()).toBeUndefined();
    expect(undoDepth()).toBe(0);
  });

  it('forgetUndo removes that entry and leaves the others in order', () => {
    const a = entry('a');
    const b = entry('b');
    const c = entry('c');
    pushUndo(a);
    pushUndo(b);
    pushUndo(c);
    forgetUndo(b);
    expect(undoDepth()).toBe(2);
    expect(latestUndo()).toBe(c);
  });
});

describe('useRunUndo', () => {
  it('runs the entry, takes it off the stack and confirms with a flag', async () => {
    const e = entry('status change');
    pushUndo(e);
    const { result } = renderHook(() => useRunUndo());
    act(() => result.current(e));
    expect(undoDepth()).toBe(0);
    expect(e.undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(showFlag).toHaveBeenCalledWith({ title: 'Undid status change', severity: 'success' }));
  });

  it('an entry runs at most once: a flag Undo left on screen after Ctrl+Z does nothing', async () => {
    const e = entry('status change');
    pushUndo(e);
    const { result } = renderHook(() => useRunUndo());
    act(() => result.current(e));
    act(() => result.current(e));
    expect(e.undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(showFlag).toHaveBeenCalledTimes(1));
  });

  it('stays quiet when the server rejects the undo (the mutation flag already explains it)', async () => {
    const e = entry('status change', false);
    pushUndo(e);
    const { result } = renderHook(() => useRunUndo());
    act(() => result.current(e));
    await waitFor(() => expect(e.undo).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(showFlag).not.toHaveBeenCalled();
    expect(undoDepth()).toBe(0);
  });
});
