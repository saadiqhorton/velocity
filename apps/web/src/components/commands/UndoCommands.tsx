import { useCommands } from '@/keyboard/react';
import { latestUndo, undoDepth, useRunUndo } from '@/lib/undo';
import { m } from '@/i18n';

/**
 * Ctrl/Cmd+Z runs the newest issue change (SPEC §4.12). The binding has no `allowInInput`, so
 * the engine leaves it alone while a text field or editor has focus and native undo still works
 * there. With nothing to undo the key is not consumed either.
 */
export function UndoCommands() {
  const runUndo = useRunUndo();
  useCommands(() => [
    {
      id: 'edit.undo',
      title: m.cmd.undo,
      group: 'general',
      keys: ['mod+z'],
      when: () => undoDepth() > 0,
      run: () => {
        const entry = latestUndo();
        if (entry) runUndo(entry);
      },
    },
  ]);
  return null;
}
