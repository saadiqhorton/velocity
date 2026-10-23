import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardRoot } from '@/keyboard/react';
import { pushUndo, resetUndo, undoDepth } from '@/lib/undo';
import { UndoCommands } from './UndoCommands';

const showFlag = vi.hoisted(() => vi.fn<(flag: unknown) => string>(() => 'flag-1'));

vi.mock('@velocity/ui', async (orig) => ({
  ...(await orig<typeof import('@velocity/ui')>()),
  useFlags: () => ({ showFlag, dismissFlag: vi.fn() }),
}));

function mount() {
  render(
    <>
      <KeyboardRoot />
      <UndoCommands />
      <input aria-label="Title" />
      <div aria-label="Editor" contentEditable suppressContentEditableWarning />
    </>,
  );
  // jsdom does not compute isContentEditable; a real editor surface reports true.
  Object.defineProperty(screen.getByLabelText('Editor'), 'isContentEditable', { value: true });
}

beforeEach(() => {
  resetUndo();
  showFlag.mockClear();
});

describe('Ctrl/Cmd+Z', () => {
  it('runs the newest change, takes it off the stack and confirms it', async () => {
    mount();
    const older = vi.fn(async () => true);
    const newer = vi.fn(async () => true);
    pushUndo({ label: 'priority change', undo: older });
    pushUndo({ label: 'status change', undo: newer });

    const consumed = fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true }) === false;
    expect(consumed).toBe(true);
    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();
    expect(undoDepth()).toBe(1);
    await waitFor(() => expect(showFlag).toHaveBeenCalledWith({ title: 'Undid status change', severity: 'success' }));
  });

  it('Cmd+Z (mac) undoes too', () => {
    mount();
    const undo = vi.fn(async () => true);
    pushUndo({ label: 'status change', undo });
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('is left to a text field: the engine does not consume it, so native undo runs', () => {
    mount();
    const undo = vi.fn(async () => true);
    pushUndo({ label: 'status change', undo });
    const consumed = fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'z', ctrlKey: true }) === false;
    expect(consumed).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    expect(undoDepth()).toBe(1);
  });

  it('is left to a rich text editor (contenteditable) too', () => {
    mount();
    const undo = vi.fn(async () => true);
    pushUndo({ label: 'status change', undo });
    const consumed = fireEvent.keyDown(screen.getByLabelText('Editor'), { key: 'z', ctrlKey: true }) === false;
    expect(consumed).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });

  it('does not take Ctrl+Shift+Z (redo) or key repeats', () => {
    mount();
    const undo = vi.fn(async () => true);
    pushUndo({ label: 'status change', undo });
    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, repeat: true });
    expect(undo).not.toHaveBeenCalled();
  });

  it('with nothing to undo, the key is not consumed', () => {
    mount();
    const consumed = fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true }) === false;
    expect(consumed).toBe(false);
    expect(showFlag).not.toHaveBeenCalled();
  });
});
