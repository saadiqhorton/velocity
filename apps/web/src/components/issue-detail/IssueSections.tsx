import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Icon } from '@velocity/ui';
import { useUi } from '@/stores/ui';
import { m } from '@/i18n';
import type { DetailIssue } from './IssueDetail';
import { SubIssues } from './SubIssues';
import { Relations } from './Relations';
import { Attachments, useAttachFile } from './Attachments';

export function Section({ title, children, action, count }: { title: string; children: ReactNode; action?: ReactNode; count?: string }) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex h-7 items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-base font-medium text-fg-subtle">
          {title}
          {count ? <span className="font-normal text-fg-subtlest">{count}</span> : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Sub-issues, relations and files (SPEC §3.5.2-3.5.3). A section renders only when it has content.
 * Empty ones collapse into one row of quiet actions under the description, so a bare issue reads as a document.
 */
export function IssueSections({ issue, showCount }: { issue: DetailIssue; showCount?: boolean }) {
  const openPicker = useUi((s) => s.openPicker);
  const attach = useAttachFile(issue);
  const [addingSub, setAddingSub] = useState(false);
  const rollup = issue.subIssueRollup;
  const showSub = issue.children.length > 0 || addingSub;
  const showRelations = issue.relations.length > 0;
  const showFiles = issue.attachments.length > 0;
  const anyEmpty = !showSub || !showRelations || !showFiles;
  return (
    <>
      {anyEmpty ? (
        <div className="flex flex-wrap items-center gap-1 px-1" data-testid="issue-empty-actions">
          {showSub ? null : (
            <Button size="sm" variant="subtle" iconBefore={<Icon name="add" />} onClick={() => setAddingSub(true)}>
              {m.issue.addSubIssue}
            </Button>
          )}
          {showRelations ? null : (
            <Button
              size="sm"
              variant="subtle"
              iconBefore={<Icon name="relation" />}
              onClick={(e) => openPicker({ kind: 'relation', issueIds: [issue.id], anchor: e.currentTarget })}
            >
              {m.issue.addRelation}
            </Button>
          )}
          {showFiles ? null : (
            <>
              {attach.picker}
              <Button size="sm" variant="subtle" iconBefore={<Icon name="paperclip" />} disabled={attach.loading} onClick={attach.pick}>
                {m.issue.attach}
              </Button>
            </>
          )}
        </div>
      ) : null}
      {showSub ? (
        <Section title={m.issue.subIssues} count={showCount && rollup.total > 0 ? m.issue.subIssueRollup(rollup.done, rollup.total) : undefined}>
          <SubIssues issue={issue} adding={addingSub} onAddingChange={setAddingSub} />
        </Section>
      ) : null}
      {showRelations ? (
        <Section title={m.issue.relations}>
          <Relations issue={issue} />
        </Section>
      ) : null}
      {showFiles ? (
        <Section title={m.issuePage.attachments}>
          <Attachments issue={issue} />
        </Section>
      ) : null}
    </>
  );
}
