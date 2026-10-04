import { useMemo } from 'react';
import { Icon } from '@velocity/ui';
import { ListScreen } from '@/components/issues/ListScreen';
import { DEFAULT_DISPLAY } from '@/lib/viewState';
import type { ViewState } from '@/lib/viewState';
import { m } from '@/i18n';

/** Workspace-wide issue list (G then A). */
export function AllIssues() {
  const defaults = useMemo<ViewState>(() => ({ filter: '', display: { ...DEFAULT_DISPLAY, grouping: 'team' } }), []);
  return <ListScreen listId="all-issues" title={m.nav.allIssues} icon={<Icon name="list" className="text-fg-subtle" />} scope={{}} defaults={defaults} />;
}
