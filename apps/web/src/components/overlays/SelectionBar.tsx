import type { MouseEvent } from 'react';
import { Button, Icon, IconButton } from '@velocity/ui';
import { useSelection } from '@/stores/selection';
import { useUi } from '@/stores/ui';
import type { PickerKind } from '@/stores/ui';
import { useArchiveIssues } from '@/components/issues/actions';
import { useFeatures } from '@/lib/features';
import { m } from '@/i18n';

/** Bottom selection action bar (SPEC §4.12): count + bulk status/assignee/priority/labels/project/cycle/archive/delete. */
export function SelectionBar() {
  const features = useFeatures();
  const selected = useSelection((s) => s.selected);
  const clear = useSelection((s) => s.clear);
  const openPicker = useUi((s) => s.openPicker);
  const askDelete = useUi((s) => s.askDelete);
  const archive = useArchiveIssues();
  if (selected.size === 0) return null;
  const ids = [...selected];
  const pick = (kind: PickerKind) => (e: MouseEvent<HTMLButtonElement>) => openPicker({ kind, issueIds: ids, anchor: e.currentTarget });
  return (
    <div
      role="toolbar"
      aria-label={m.issue.selectedCount(selected.size)}
      data-testid="selection-bar"
      onKeyDown={(event) => {
        // Let focused toolbar buttons handle activation instead of opening the active issue.
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
      className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-overlay py-1 pl-3 pr-1 text-base text-fg shadow-overlay"
      style={{ zIndex: 'var(--ds-z-index-dropdown)' }}
    >
      <span className="pr-2 font-medium" aria-live="polite">
        {m.issue.selectedCount(selected.size)}
      </span>
      <Button size="sm" variant="subtle" iconBefore={<Icon name="success" />} onClick={pick('status')}>
        {m.issue.status}
      </Button>
      <Button size="sm" variant="subtle" iconBefore={<Icon name="user" />} onClick={pick('assignee')}>
        {m.issue.assignee}
      </Button>
      <Button size="sm" variant="subtle" iconBefore={<Icon name="priority-high" />} onClick={pick('priority')}>
        {m.issue.priority}
      </Button>
      <Button size="sm" variant="subtle" iconBefore={<Icon name="label" />} onClick={pick('labels')} data-testid="bulk-labels">
        {m.issue.labels}
      </Button>
      <Button size="sm" variant="subtle" iconBefore={<Icon name="project" />} onClick={pick('project')}>
        {m.issue.project}
      </Button>
      {features.cycles ? (
        <Button size="sm" variant="subtle" iconBefore={<Icon name="cycle" />} onClick={pick('cycle')}>
          {m.issue.cycle}
        </Button>
      ) : null}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      <IconButton label={m.common.archive} size="sm" icon={<Icon name="archive" />} onClick={() => void archive(ids)} />
      <IconButton label={m.common.delete} size="sm" icon={<Icon name="trash" />} onClick={() => askDelete(ids)} />
      <IconButton label={m.issue.clearSelection} size="sm" icon={<Icon name="close" />} onClick={clear} />
    </div>
  );
}
