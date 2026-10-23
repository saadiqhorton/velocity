import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Icon, InlineMessage } from '@velocity/ui';
import { ListScreen } from '@/components/issues/ListScreen';
import { DEFAULT_DISPLAY } from '@/lib/viewState';
import type { ViewState } from '@/lib/viewState';
import { useUi } from '@/stores/ui';
import { m } from '@/i18n';
import type { Milestone } from './ProjectMilestones';
import { MilestoneIcon } from './projectUi';

/** Project issue scope, including a shareable milestone drill-down from the overview. */
export function ProjectIssues({ projectId, projectName, teamId, milestones }: { projectId: string; projectName: string; teamId?: string; milestones: Milestone[] }) {
  const [params, setParams] = useSearchParams();
  const openCreate = useUi((s) => s.openCreate);
  const defaults = useMemo<ViewState>(() => ({ filter: '', display: DEFAULT_DISPLAY }), []);
  const milestoneId = params.get('milestone') || undefined;
  const milestone = milestones.find((item) => item.id === milestoneId);
  const clearMilestone = () => setParams((previous) => {
    const next = new URLSearchParams(previous);
    next.delete('milestone');
    return next;
  });
  // A stale or foreign milestone link must never silently display the entire project.
  if (milestoneId && !milestone) {
    return <div className="p-5"><InlineMessage appearance="warning" title={m.project.milestoneNotFound} /><Button variant="subtle" onClick={clearMilestone}>{m.project.showAllIssues}</Button></div>;
  }
  const context = { projectId, teamId, ...(milestoneId ? { milestoneId } : {}) };
  return (
    <ListScreen
      embedded
      listId={`project-${projectId}`}
      title={projectName}
      scope={{ projectId, ...(milestoneId ? { milestoneId } : {}) }}
      defaults={defaults}
      context={context}
      hiddenFilterFields={['project']}
      headerExtra={milestone ? (
        <button
          type="button"
          aria-label={m.project.clearMilestoneFilter(milestone.name)}
          onClick={clearMilestone}
          className="flex h-7 max-w-64 shrink-0 items-center gap-2 rounded-sm border border-border bg-neutral px-2 text-sm text-fg hover:bg-neutral-hover"
        >
          <MilestoneIcon status={milestone.status} percent={milestone.progress.percent} />
          <span className="truncate">{milestone.name}</span>
          <Icon name="close" className="h-3 w-3 shrink-0 text-fg-subtle" />
        </button>
      ) : null}
      actions={<Button size="sm" variant="primary" iconBefore={<Icon name="add" />} onClick={() => openCreate(context)}>{m.issue.newIssue}</Button>}
    />
  );
}
