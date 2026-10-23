import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Menu, Popover } from '@velocity/ui';
import { useUi } from '@/stores/ui';
import { IssueMenuItems } from './IssueMenuItems';
import { m } from '@/i18n';

/** Returns focus to where it was when the menu opened (SPEC §4.12 focus rules). */
function FocusReturn({ previous, frame }: { previous: HTMLElement | null; frame: MutableRefObject<number | undefined> }) {
  useEffect(
    () => {
      // A new session (or StrictMode effect replay) supersedes any pending focus return.
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      return () => {
        frame.current = requestAnimationFrame(() => {
          if (useUi.getState().contextMenu) return;
          const active = document.activeElement;
          if (previous && document.contains(previous) && (!active || active === document.body)) previous.focus({ preventScroll: true });
        });
      };
    },
    [previous, frame],
  );
  return null;
}

function focusTarget(fallback: HTMLElement | null = null): HTMLElement | null {
  const active = document.activeElement;
  // Rapid reopen can happen before the closing session has returned focus.
  return active instanceof HTMLElement && active !== document.body && !active.closest('[role="menu"], [role="listbox"], [aria-hidden="true"]') ? active : fallback;
}

/**
 * The issue context menu (SPEC §4.12 `V`; Roadmap v1.2 U2): right-click on a row or card,
 * `V`, `Shift+F10` or the Menu key. Items are shared with the issue page's ⋯ menu.
 */
export function IssueContextMenu() {
  const req = useUi((s) => s.contextMenu);
  const close = useUi((s) => s.closeContextMenu);
  const restoreFrame = useRef<number>();
  // Keep the last request available while Popover owns the exit. A new request resets menu focus and submenus.
  const [retained, setRetained] = useState(() => ({ req, session: 0, previous: focusTarget() }));
  if (req && req !== retained.req) setRetained({ req, session: retained.session + 1, previous: focusTarget(retained.previous) });
  const shown = req ?? retained.req;
  return (
    <>
      {req ? <FocusReturn key={retained.session} previous={retained.previous} frame={restoreFrame} /> : null}
      <Popover anchorEl={shown?.anchor ?? null} open={req !== null} placement="bottom-start" onDismiss={close} className="py-0">
        {/* Esc on the top-level menu closes it (a submenu's Esc only closes the submenu). */}
        <div
          key={retained.session}
          onKeyDownCapture={(e) => {
            const menu = (e.target as HTMLElement).closest('[role="menu"]');
            if (e.key === 'Escape' && menu && menu === e.currentTarget.firstElementChild) {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        >
          {/* Reset the menu tree on close so its separately portaled submenus cannot remain interactive. */}
          <Menu key={`${retained.session}-${Boolean(req)}`} aria-label={m.issue.contextMenu} autoFocus={Boolean(req)}>
            {shown ? <IssueMenuItems issueIds={shown.issueIds} onAction={close} /> : null}
          </Menu>
        </div>
      </Popover>
    </>
  );
}
