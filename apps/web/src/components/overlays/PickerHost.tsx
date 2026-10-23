import { useEffect, useState } from 'react';
import { PopupSelect } from '@velocity/ui';
import { useUi } from '@/stores/ui';
import type { PickerRequest } from '@/stores/ui';
import { usePickerSpec } from './usePickerSpec';
import { RelationDialog } from './RelationDialog';

function ActivePicker({ req }: { req: PickerRequest }) {
  const close = useUi((s) => s.closePicker);
  const spec = usePickerSpec(req.kind, req.issueIds);
  const key = `${req.kind}-${req.issueIds.join(',')}`;
  const onOpenChange = (open: boolean) => {
    if (!open) close();
  };
  if (!spec) return null;
  if (spec.multiple) {
    return (
      <PopupSelect
        key={key}
        label={spec.label}
        options={spec.options}
        anchorEl={req.anchor}
        open
        onOpenChange={onOpenChange}
        multiple
        value={spec.value}
        onChange={spec.commit}
      />
    );
  }
  return (
    <PopupSelect
      key={key}
      label={spec.label}
      options={spec.options}
      anchorEl={req.anchor}
      open
      onOpenChange={onOpenChange}
      value={spec.value}
      onChange={spec.commit}
    />
  );
}

/** Returns focus to where it was when the popup opened (SPEC §4.12 focus rules). */
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

/** Shortcut popups (S, A, L, P, M…) anchored to the focused row (SPEC §4.12). */
export function PickerHost() {
  const req = useUi((s) => s.picker);
  const close = useUi((s) => s.closePicker);
  if (!req) return null;
  return (
    <>
      <FocusReturn />
      {req.kind === 'relation' ? <RelationDialog issueId={req.issueIds[0] ?? ''} onClose={close} /> : <ActivePicker req={req} />}
    </>
  );
}
