import { ConfirmDialog } from '@velocity/ui';
import { useUi } from '@/stores/ui';
import { useTrashIssues } from '@/components/issues/actions';
import { m } from '@/i18n';

/** `#` → delete with confirmation (SPEC §4.12); deleted issues go to trash for 30 days. */
export function DeleteConfirmHost() {
  const ids = useUi((s) => s.confirmDelete);
  const close = useUi((s) => s.closeDelete);
  const trash = useTrashIssues();
  return (
    <ConfirmDialog
      open={ids !== null}
      title={m.issue.deleteConfirmTitle(ids?.length ?? 1)}
      description={m.issue.deleteConfirmBody}
      confirmLabel={m.common.delete}
      onClose={close}
      onConfirm={() => {
        const target = ids ?? [];
        close();
        void trash(target);
      }}
    />
  );
}
