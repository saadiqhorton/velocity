import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState, Icon } from '@velocity/ui';
import { useWorkspace } from '@/app/workspace';
import { PresetTabs } from '@/components/common/PresetTabs';
import { ListScreen } from '@/components/issues/ListScreen';
import { DEFAULT_DISPLAY } from '@/lib/viewState';
import type { ViewState } from '@/lib/viewState';
import { m } from '@/i18n';

type Preset = 'assigned' | 'created' | 'subscribed';
const PRESETS: Preset[] = ['assigned', 'created', 'subscribed'];

/** My Issues with presets Open (assigned to me, not done), Created, Subscribed (SPEC §3.10). */
export function MyIssues() {
  const { preset: raw } = useParams();
  const preset: Preset = PRESETS.includes(raw as Preset) ? (raw as Preset) : 'assigned';
  const { viewer } = useWorkspace();
  const defaults = useMemo<ViewState>(() => ({ filter: '', display: { ...DEFAULT_DISPLAY, grouping: 'status', showCompleted: preset === 'assigned' ? 'none' : 'all' } }), [preset]);
  const extra = preset === 'assigned' ? ['assignee:me'] : preset === 'created' ? ['creator:me'] : [];
  const navigate = useNavigate();
  const tabs = (
    <PresetTabs
      aria-label={m.myIssues.presetTabs}
      value={preset}
      onChange={(p) => navigate(p === 'assigned' ? '/my-issues' : `/my-issues/${p}`)}
      tabs={PRESETS.map((p) => ({ id: p, label: m.myIssues.presets[p] }))}
    />
  );
  return (
    <ListScreen
      key={preset}
      listId={`my-issues-${preset}`}
      title={m.myIssues.title}
      icon={<Icon name="my-issues" className="text-fg-subtle" />}
      scope={preset === 'subscribed' ? { subscribed: true } : {}}
      defaults={defaults}
      extraFilters={extra}
      context={{ assigneeId: preset === 'assigned' ? viewer.id : undefined }}
      headerExtra={tabs}
      hiddenFilterFields={preset === 'assigned' ? ['assignee'] : preset === 'created' ? ['creator'] : []}
      empty={<EmptyState icon="my-issues" message={preset === 'created' ? m.myIssues.emptyCreated : preset === 'subscribed' ? m.myIssues.emptySubscribed : m.list.emptyMine} />}
    />
  );
}
