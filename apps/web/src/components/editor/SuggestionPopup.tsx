import { useId, useLayoutEffect, useRef, useState } from 'react';
import { OptionList, Portal, computePosition } from '@velocity/ui';
import { m } from '@/i18n';
import type { SuggestionOwner, SuggestionPopupModel } from './suggestions';

const OWNER_LABEL: Record<SuggestionOwner, () => string> = {
  slash: () => m.editor.menuCommands,
  mention: () => m.editor.menuMembers,
  issue: () => m.editor.menuIssues,
};

/**
 * The `/`, `@` and `#` list. Rendered in a portal under the caret; mousedown is cancelled so the
 * editor keeps focus and the selection while the user clicks a row.
 */
export function SuggestionPopup({ popup }: { popup: SuggestionPopupModel }) {
  const listId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !popup.rect) return;
    const placed = computePosition(
      popup.rect,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      'bottom-start',
      4,
      8,
    );
    setPos({ top: placed.top, left: placed.left });
  }, [popup]);

  return (
    <Portal>
      <div
        ref={ref}
        data-suggestion-popup={popup.owner}
        onMouseDown={(e) => e.preventDefault()}
        className="max-w-[calc(100vw-16px)] min-w-56 overflow-hidden rounded-md border border-border bg-overlay text-fg shadow-overlay"
        style={{
          position: 'fixed',
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          visibility: pos ? 'visible' : 'hidden',
          zIndex: 'var(--ds-z-index-dropdown)',
        }}
      >
        <OptionList
          id={listId}
          aria-label={OWNER_LABEL[popup.owner]()}
          options={popup.options}
          selectedValues={[]}
          activeValue={popup.activeValue}
          onActiveChange={popup.hover}
          onSelect={(option) => popup.pick(option.value)}
          emptyMessage={popup.emptyMessage}
        />
      </div>
    </Portal>
  );
}
