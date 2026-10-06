import { Suspense, lazy } from 'react';
import { useUi } from '@/stores/ui';
import { PickerHost } from '@/components/overlays/PickerHost';
import { SelectionBar } from '@/components/overlays/SelectionBar';
import { DeleteConfirmHost } from '@/components/overlays/DeleteConfirmHost';
import { IssueContextMenu } from '@/components/overlays/IssueContextMenu';
import { CONTEXT_ANCHOR_ID } from '@/components/issues/rowActions';

const CommandPalette = lazy(() => import('@/components/palette/CommandPalette').then((mod) => ({ default: mod.CommandPalette })));
const ShortcutsHelp = lazy(() => import('@/components/palette/ShortcutsHelp').then((mod) => ({ default: mod.ShortcutsHelp })));
const CreateIssueModal = lazy(() => import('@/components/overlays/CreateIssueModal').then((mod) => ({ default: mod.CreateIssueModal })));

/** App-level overlays. Heavy ones load on first use. */
export function Overlays() {
  const paletteOpen = useUi((s) => s.paletteOpen);
  const shortcutsOpen = useUi((s) => s.shortcutsOpen);
  const createOpen = useUi((s) => s.createOpen);
  return (
    <>
      {/* Fallback anchor for shortcut popups when nothing is focused. */}
      <div id="picker-anchor" aria-hidden="true" className="pointer-events-none fixed left-1/2 top-24 h-px w-px" />
      {/* Moved to the pointer for right-click context menus (rowActions.ts). */}
      <div id={CONTEXT_ANCHOR_ID} aria-hidden="true" className="pointer-events-none fixed left-0 top-0 h-px w-px" />
      <PickerHost />
      <IssueContextMenu />
      <SelectionBar />
      <DeleteConfirmHost />
      <Suspense fallback={null}>
        {paletteOpen ? <CommandPalette /> : null}
        {shortcutsOpen ? <ShortcutsHelp /> : null}
        {createOpen ? <CreateIssueModal /> : null}
      </Suspense>
    </>
  );
}
