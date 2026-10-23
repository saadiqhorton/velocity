/**
 * Session undo stack (Roadmap v1.2 U1). An issue edit pushes an entry once it is applied;
 * Ctrl/Cmd+Z and the Undo action on a flag run the newest one. Entries are closures over the
 * optimistic issue hooks (components/issues/actions.ts), so an undo is itself optimistic and
 * synced to the server like any other edit.
 */
import { useCallback } from 'react';
import { useFlags } from '@velocity/ui';
import { m } from '@/i18n';

export interface UndoEntry {
  /** What changed, for the confirmation flag: "Undid {label}". */
  label: string;
  /** Re-applies the previous values. Resolves true when the server accepted them. */
  undo: () => Promise<boolean>;
}

export const MAX_UNDO_ENTRIES = 20;

let stack: UndoEntry[] = [];

/** Push an entry; the oldest one falls off once the stack is full. */
export function pushUndo(entry: UndoEntry): void {
  stack = [...stack, entry].slice(-MAX_UNDO_ENTRIES);
}

/** The newest entry, or undefined when there is nothing to undo. */
export function latestUndo(): UndoEntry | undefined {
  return stack[stack.length - 1];
}

export function undoDepth(): number {
  return stack.length;
}

/** Remove an entry without running it: it was undone, or the server rejected the change. */
export function forgetUndo(entry: UndoEntry): void {
  stack = stack.filter((e) => e !== entry);
}

export function resetUndo(): void {
  stack = [];
}

/** Run an entry, take it off the stack, and confirm with a flag when the server accepted it. */
export function useRunUndo(): (entry: UndoEntry) => void {
  const { showFlag } = useFlags();
  return useCallback(
    (entry: UndoEntry) => {
      // An entry runs at most once: a flag's Undo that is still on screen after Ctrl+Z must not write the old value again.
      if (!stack.includes(entry)) return;
      forgetUndo(entry);
      void entry.undo().then((ok) => {
        if (ok) showFlag({ title: m.undo.undone(entry.label), severity: 'success' });
      });
    },
    [showFlag],
  );
}
