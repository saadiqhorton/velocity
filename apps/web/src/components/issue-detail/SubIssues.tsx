import { Avatar, Button, Icon, PriorityIcon, StatusIcon, priorityNames } from '@velocity/ui';
import { useOpenIssue } from '@/lib/navigation';
import { useUi } from '@/stores/ui';
import { PRIORITY_KEYS } from '@/components/issues/IssueRow';
import { InlineProp } from '@/components/issues/InlineProp';
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
        // The row opens the sub-issue; its priority, status and assignee edit in place.
        <div
          key={c.id}
          onClick={() => openIssue(c.id)}
          className="group/sub flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1 text-base transition-colors duration-100 hover:bg-hover"
        >
          <InlineProp
            kind="priority"
            issueId={c.id}
            label={`${m.issue.priority}: ${priorityNames[PRIORITY_KEYS[c.priority] ?? 'none']}`}
            className="h-6 w-6"
          >
            <PriorityIcon priority={PRIORITY_KEYS[c.priority] ?? 'none'} label="" />
          </InlineProp>
          <span className="identifier shrink-0">{c.identifier}</span>
          <InlineProp kind="status" issueId={c.id} label={`${m.issue.status}: ${c.status.name}`} className="h-6 w-6">
            <StatusIcon category={c.status.category} color={c.status.color} label="" />
          </InlineProp>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openIssue(c.id);
            }}
            className="min-w-0 flex-1 truncate rounded-sm text-left font-medium text-fg focus-visible:-outline-offset-2"
          >
            {c.title}
          </button>
          <InlineProp
            kind="assignee"
            issueId={c.id}
            label={`${m.issue.assignee}: ${c.assignee?.name ?? m.issue.noAssignee}`}
            className="h-6 w-6 rounded-full"
          >
            {c.assignee ? (
              <Avatar name={c.assignee.name} src={c.assignee.avatarUrl} size={20} />
            ) : (
              <Icon name="user" className="text-fg-subtlest opacity-60" />
            )}
          </InlineProp>
        </div>
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
