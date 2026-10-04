import { Avatar, Button, Icon, PriorityIcon, StatusIcon } from '@velocity/ui';
import { useOpenIssue } from '@/lib/navigation';
import { useUi } from '@/stores/ui';
import { PRIORITY_KEYS } from '@/components/issues/IssueRow';
import type { DetailIssue } from './IssueDetail';
import { m } from '@/i18n';

/** Sub-issue tree with done/total rollup (SPEC §3.5.2). */
export function SubIssues({ issue }: { issue: DetailIssue }) {
  const openIssue = useOpenIssue();
  const openCreate = useUi((s) => s.openCreate);
  const children = issue.children;
  const rollup = issue.subIssueRollup;
  return (
    <div className="flex flex-col" data-testid="sub-issues">
      {children.length > 0 ? (
        <div className="mb-1 flex items-center gap-2 px-1 text-sm text-fg-subtlest">
          <Icon name="sub-issue" className="h-3 w-3" />
          {m.issue.subIssueRollup(rollup.done, rollup.total)}
        </div>
      ) : null}
      {children.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => openIssue(c.id)}
          className="flex h-8 min-w-0 items-center gap-2 rounded-sm px-1 text-left text-base transition-colors duration-100 hover:bg-hover"
        >
          <PriorityIcon priority={PRIORITY_KEYS[c.priority] ?? 'none'} />
          <span className="identifier shrink-0">{c.identifier}</span>
          <StatusIcon category={c.status.category} color={c.status.color} label={c.status.name} />
          <span className="min-w-0 flex-1 truncate text-fg">{c.title}</span>
          {c.assignee ? <Avatar name={c.assignee.name} src={c.assignee.avatarUrl} size={20} /> : null}
        </button>
      ))}
      <div>
        <Button
          size="sm"
          variant="subtle"
          iconBefore={<Icon name="add" />}
          onClick={() => openCreate({ teamId: issue.teamId, parentId: issue.id, projectId: issue.projectId, cycleId: issue.cycleId })}
        >
          {m.issue.addSubIssue}
        </Button>
      </div>
    </div>
  );
}
