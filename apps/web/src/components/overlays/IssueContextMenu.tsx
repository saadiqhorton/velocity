import { useEffect, useState } from 'react';
import { Menu, Popover } from '@velocity/ui';
import { useUi } from '@/stores/ui';
import { IssueMenuItems } from './IssueMenuItems';
import { m } from '@/i18n';

/** Returns focus to where it was when the menu opened (SPEC §4.12 focus rules). */
function FocusReturn() {
  const [previous] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (previous && document.contains(previous) && (!active || active === document.body)) previous.focus({ preventScroll: true });
      });
    },
    [previous],
  );
  return null;
}

/**
 * The issue context menu (SPEC §4.12 `V`; Roadmap v1.2 U2): right-click on a row or card,
 * `V`, `Shift+F10` or the Menu key. Items are shared with the issue page's ⋯ menu.
 */
export function IssueContextMenu() {
  const req = useUi((s) => s.contextMenu);
  const close = useUi((s) => s.closeContextMenu);
  if (!req) return null;
  return (
    <>
      <FocusReturn />
      <Popover anchorEl={req.anchor} open placement="bottom-start" onDismiss={close} className="py-0">
        {/* Esc on the top-level menu closes it (a submenu's Esc only closes the submenu). */}
        <div
          onKeyDownCapture={(e) => {
            const menu = (e.target as HTMLElement).closest('[role="menu"]');
            if (e.key === 'Escape' && menu && menu === e.currentTarget.firstElementChild) {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        >
          <Menu aria-label={m.issue.contextMenu} autoFocus>
            <IssueMenuItems issueIds={req.issueIds} anchor={req.anchor} onAction={close} />
          </Menu>
        </div>
      </Popover>
    </>
  );
}
