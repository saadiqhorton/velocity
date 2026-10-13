import type { ReactNode } from 'react';
import clsx from 'clsx';
import { useUi } from '@/stores/ui';
import type { PickerKind } from '@/stores/ui';

export interface InlinePropProps {
  kind: PickerKind;
  issueId: string;
  /** Accessible name, e.g. "Priority: High". */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A property shown on an issue row or card that edits in place: clicking it opens the
 * same picker as the keyboard shortcut (PickerHost), anchored to the property itself.
 * The click never reaches the row, so it doesn't open, select or drag the issue.
 * Rows keep their roving focus, so the trigger is out of the tab order; keyboard
 * users have the S/P/A/L/… shortcuts on the focused row.
 */
export function InlineProp({ kind, issueId, label, children, className }: InlinePropProps) {
  const openPicker = useUi((s) => s.openPicker);
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      aria-haspopup="listbox"
      data-inline-prop={kind}
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        openPicker({ kind, issueIds: [issueId], anchor: e.currentTarget });
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={clsx(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors duration-100 hover:bg-neutral-hover active:bg-pressed',
        className,
      )}
    >
      {children}
    </button>
  );
}
