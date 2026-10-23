import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Icon, PriorityIcon, StatusIcon, priorityNames } from '@velocity/ui';
import { useCreateIssue } from '@/components/issues/actions';
import { useOpenIssue } from '@/lib/navigation';
import { PRIORITY_KEYS } from '@/components/issues/IssueRow';
import { InlineProp } from '@/components/issues/InlineProp';
import type { DetailIssue } from './IssueDetail';
import { m } from '@/i18n';

/**
 * Single-line title field at the end of the list. Enter adds a sub-issue and keeps the field open
 * for the next one; Esc, or leaving the field while it is empty, closes it.
 */
function QuickAdd({ issue, onClose }: { issue: DetailIssue; onClose: () => void }) {
  const [create] = useCreateIssue();
  const [title, setTitle] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <div className="flex h-8 min-w-0 items-center gap-2 px-1 text-base">
      <Icon name="sub-issue" className="shrink-0 text-fg-subtlest" />
      <input
        ref={input}
        value={title}
        aria-label={m.issue.subIssueTitle}
        placeholder={m.issue.subIssueTitle}
        data-testid="sub-issue-quick-add"
        className="min-w-0 flex-1 bg-transparent font-medium text-fg outline-none placeholder:font-normal placeholder:text-fg-subtlest"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            const next = title.trim();
            if (!next) return;
            setTitle('');
            void create({ title: next, parentId: issue.id, teamId: issue.teamId });
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        onBlur={() => {
          if (!title.trim()) onClose();
        }}
      />
    </div>
  );
}

/** Sub-issue tree with done/total rollup (SPEC §3.5.2). Adding opens an inline title field, not the full create form. */
export function SubIssues({ issue, adding, onAddingChange }: { issue: DetailIssue; adding: boolean; onAddingChange: (adding: boolean) => void }) {
  const openIssue = useOpenIssue();
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
        // Title opens the sub-issue (keyboard + pointer); priority, status and assignee edit in place.
        <div
          key={c.id}
          className="group/sub flex h-8 min-w-0 items-center gap-2 rounded-sm px-1 text-base transition-colors duration-100 hover:bg-hover"
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
            onClick={() => openIssue(c.id)}
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
      {adding ? <QuickAdd issue={issue} onClose={() => onAddingChange(false)} /> : null}
      {adding ? null : (
        <div>
          <Button size="sm" variant="subtle" iconBefore={<Icon name="add" />} onClick={() => onAddingChange(true)}>
            {m.issue.addSubIssue}
          </Button>
        </div>
      )}
    </div>
  );
}
