import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Button, DropdownMenu, EmptyState, Icon, IconButton, Lozenge, Skeleton, StatusIcon, Tabs } from '@velocity/ui';
import { IssueDetailDocument, SetIssueSubscribedDocument, UpdateIssueDescriptionDocument } from '@/gql/graphql';
import type { IssueDetailQuery } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useOptimisticMutation } from '@/lib/mutation';
import { useOpenIssue } from '@/lib/navigation';
import { formatRelative } from '@/lib/format';
import { useDetailIssue } from '@/stores/detail';
import { useRecent } from '@/stores/recent';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { LazyEditor } from '@/components/editor/LazyEditor';
import { IssueProperties } from '@/components/issues/IssueProperties';
import { TeamIcon } from '@/components/common/EntityIcons';
import { useUpdateIssues } from '@/components/issues/actions';
import { useIssueAi } from '@/components/issues/useIssueAi';
import { IssueMenuItems } from '@/components/overlays/IssueMenuItems';
import { SubIssues } from './SubIssues';
import { Relations } from './Relations';
import { Comments } from './Comments';
import { ActivityFeed } from './ActivityFeed';
import { GithubLinks } from './GithubLinks';
import { ActivityTimeline } from './ActivityTimeline';
import { Attachments } from './Attachments';
import { IssuePageHeader, PromptSplitButton } from './IssuePageHeader';
import { m } from '@/i18n';

export type DetailIssue = NonNullable<IssueDetailQuery['issue']>;

const STATUS_LOZENGE: Record<string, 'default' | 'inprogress' | 'success' | 'removed' | 'new' | 'moved'> = {
  backlog: 'default',
  todo: 'new',
  in_progress: 'inprogress',
  done: 'success',
  canceled: 'default',
};

/** Inline title with 500ms debounced autosave (SPEC §4.11.3). */
function TitleEditor({ issue }: { issue: DetailIssue }) {
  const update = useUpdateIssues();
  const [value, setValue] = useState(issue.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setValue(issue.title);
  }, [issue.title]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const save = (next: string) => {
    const t = next.replace(/\s+/g, ' ').trim();
    if (t && t !== issue.title) void update([issue.id], { title: t });
  };

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={m.issue.title}
      data-testid="issue-title"
      value={value}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(e) => {
        const next = e.target.value.replace(/\n/g, ' ');
        setValue(next);
        if (pending.current) clearTimeout(pending.current);
        pending.current = setTimeout(() => save(next), 500);
      }}
      onBlur={() => {
        editing.current = false;
        if (pending.current) clearTimeout(pending.current);
        save(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setValue(issue.title);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className="w-full resize-none overflow-hidden rounded-sm bg-transparent px-1 py-0.5 text-xl font-semibold leading-7 text-fg outline-none hover:bg-hover focus:bg-transparent focus-visible:outline-2 focus-visible:outline-focus"
    />
  );
}

/** Description: always-editable markdown; saves 800ms after typing stops and on blur. */
function DescriptionEditor({ issue }: { issue: DetailIssue }) {
  const [save] = useOptimisticMutation(UpdateIssueDescriptionDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      updateIssue: { __typename: 'Issue' as const, id: vars.id, descriptionMd: vars.descriptionMd, updatedAt: new Date().toISOString() },
    }),
    rollback: () => m.flags.rollback.update(issue.identifier),
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(issue.descriptionMd);
  const flush = (md: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (md === last.current) return;
    last.current = md;
    void save({ id: issue.id, descriptionMd: md });
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="rounded-sm px-1" data-testid="issue-description">
      <LazyEditor
        key={issue.id}
        value={issue.descriptionMd}
        ariaLabel={m.common.description}
        placeholder={m.issue.descriptionPlaceholder}
        onChange={(md) => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(md), 800);
        }}
        onBlur={flush}
        onEscape={() => (document.activeElement as HTMLElement | null)?.blur()}
      />
    </div>
  );
}

/** The page's Activity subscribe toggle: a labelled button rather than a bare bell. */
function SubscribeToggle({ issue }: { issue: DetailIssue }) {
  const [set] = useOptimisticMutation(SetIssueSubscribedDocument, {
    optimistic: (vars) => ({ __typename: 'Mutation' as const, setIssueSubscribed: { __typename: 'Issue' as const, id: vars.id, subscribed: vars.subscribed } }),
    rollback: () => m.flags.rollback.generic,
  });
  return (
    <Button
      size="sm"
      variant="subtle"
      aria-pressed={issue.subscribed}
      data-testid="subscribe-toggle"
      iconBefore={<Icon name="bell" className={issue.subscribed ? 'text-primary' : undefined} />}
      onClick={() => void set({ id: issue.id, subscribed: !issue.subscribed })}
    >
      {issue.subscribed ? m.issuePage.subscribed : m.issuePage.subscribe}
    </Button>
  );
}

function SubscribeButton({ issue }: { issue: DetailIssue }) {
  const [set] = useOptimisticMutation(SetIssueSubscribedDocument, {
    optimistic: (vars) => ({ __typename: 'Mutation' as const, setIssueSubscribed: { __typename: 'Issue' as const, id: vars.id, subscribed: vars.subscribed } }),
    rollback: () => m.flags.rollback.generic,
  });
  return (
    <IconButton
      label={issue.subscribed ? m.issue.unsubscribe : m.issue.subscribe}
      size="sm"
      aria-pressed={issue.subscribed}
      data-testid="subscribe-toggle"
      icon={<Icon name="bell" className={issue.subscribed ? 'text-primary' : undefined} />}
      onClick={() => void set({ id: issue.id, subscribed: !issue.subscribed })}
    />
  );
}

/** The peek panel's 48px header (the page has IssuePageHeader). */
function DetailHeader({ issue, onClose }: { issue: DetailIssue; onClose?: () => void }) {
  const openIssue = useOpenIssue();
  const ai = useIssueAi();
  const [moreEl, setMoreEl] = useState<HTMLButtonElement | null>(null);
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <button
        type="button"
        className="identifier shrink-0 whitespace-nowrap rounded-sm px-1 hover:bg-hover hover:text-fg"
        title={m.issue.copyId}
        onClick={() => void ai.copyId(issue.id)}
        data-testid="issue-identifier"
      >
        {issue.identifier}
      </button>
      <Lozenge appearance={STATUS_LOZENGE[issue.status.category] ?? 'default'} color={issue.status.color} data-testid="issue-status-lozenge">
        {issue.status.name}
      </Lozenge>
      {issue.archivedAt ? <Lozenge appearance="default">{m.issue.archived}</Lozenge> : null}
      {issue.trashedAt ? <Lozenge appearance="removed">{m.issue.trashed}</Lozenge> : null}
      <span className="flex-1" />
      <SubscribeButton issue={issue} />
      <IconButton label={m.ai.copyLink} size="sm" icon={<Icon name="link" />} onClick={() => void ai.copyLink(issue.id)} />
      <PromptSplitButton issueId={issue.id} compact />
      <DropdownMenu
        aria-label={m.issuePage.actions}
        placement="bottom-end"
        trigger={<IconButton ref={setMoreEl} label={m.issuePage.actions} size="sm" icon={<Icon name="more" />} />}
      >
        <IssueMenuItems issueIds={[issue.id]} anchor={moreEl} />
      </DropdownMenu>
      <IconButton
        label={m.issue.openFullPage}
        size="sm"
        icon={<Icon name="external-link" />}
        onClick={() => openIssue(issue.id, { identifier: issue.identifier, peek: false })}
      />
      <IconButton label={m.issue.closePanel} size="sm" icon={<Icon name="close" />} onClick={onClose} data-testid="close-panel" />
    </div>
  );
}

function Section({ title, children, action, count }: { title: string; children: ReactNode; action?: ReactNode; count?: string }) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex h-7 items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg-subtle">
          {title}
          {count ? <span className="font-normal text-fg-subtlest">{count}</span> : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DetailSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      {/* Same 48px header as the loaded detail, so nothing shifts when it arrives. */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Skeleton width={56} height={12} />
        <Skeleton width={64} height={16} />
      </div>
      <div className="flex flex-col gap-4 p-5">
        <Skeleton width="70%" height={24} />
        <Skeleton rows={4} />
      </div>
    </div>
  );
}

export interface IssueDetailProps {
  id: string;
  mode: 'panel' | 'page';
  onClose?: () => void;
}

/** Issue detail (SPEC §4.11.3) — right panel by default, full page optional. */
export function IssueDetail({ id, mode, onClose }: IssueDetailProps) {
  const ws = useWorkspace();
  // Full page: properties move from the side column (lg and up) into the main column below that.
  const wide = useMediaQuery('(min-width: 1024px)');
  const { data, loading, error } = useQuery(IssueDetailDocument, { variables: { id }, fetchPolicy: 'cache-and-network' });
  const issue = data?.issue;
  // The cache redirect can hand back a list row before the detail fields arrive.
  const complete = issue && typeof issue.descriptionMd === 'string' && Array.isArray(issue.children);
  const setDetail = useDetailIssue((s) => s.setIssue);
  const pushRecent = useRecent((s) => s.pushIssue);
  const loadedId = issue?.id ?? null;
  const loadedTeam = issue?.teamId ?? null;
  const recentLabel = issue ? { id: issue.id, identifier: issue.identifier, title: issue.title } : null;
  useEffect(() => {
    if (recentLabel && !recentLabel.identifier.endsWith('…')) pushRecent(recentLabel);
    // Record once per opened issue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedId]);
  useEffect(() => {
    if (!loadedId) return;
    setDetail(loadedId, loadedTeam);
    return () => {
      if (useDetailIssue.getState().issueId === loadedId) setDetail(null);
    };
  }, [loadedId, loadedTeam, setDetail]);

  if (!complete) {
    if (!loading && (error || data?.issue === null)) {
      return (
        <div className="flex h-full flex-col">
          {mode === 'panel' ? (
            <div className="flex h-12 items-center justify-end border-b border-border px-4">
              <IconButton label={m.issue.closePanel} size="sm" icon={<Icon name="close" />} onClick={onClose} />
            </div>
          ) : null}
          <div className="flex flex-1 items-center justify-center">
            <EmptyState icon="warning" message={m.issue.notFound} />
          </div>
        </div>
      );
    }
    return <DetailSkeleton />;
  }

  const creator = issue.creator?.name ?? m.common.unknown;
  const team = ws.teamsById.get(issue.teamId);
  const parent = issue.parent;
  const footer = (
    <div className="px-1 pb-6 text-sm text-fg-subtlest">
      {m.issue.createdBy(creator, formatRelative(issue.createdAt))} · {m.issue.updatedAt(formatRelative(issue.updatedAt))}
    </div>
  );
  const heading = (
    <div className="flex flex-col gap-1">
      {parent ? (
        <Link to={`/issue/${parent.identifier}`} className="flex items-center gap-1.5 px-1 text-sm text-fg-subtle hover:text-fg" data-testid="parent-link">
          <StatusIcon category={parent.status.category} color={parent.status.color} label="" />
          <span className="identifier">{parent.identifier}</span>
          <span className="truncate">{parent.title}</span>
        </Link>
      ) : null}
      <TitleEditor issue={issue} />
    </div>
  );

  if (mode === 'panel') {
    const tabs = [
      { id: 'comments', label: `${m.issue.comments}${issue.commentCount ? ` ${issue.commentCount}` : ''}`, panel: <Comments issueId={issue.id} /> },
      { id: 'activity', label: m.issue.activity, panel: <ActivityFeed issueId={issue.id} /> },
      ...(issue.githubLinks.length > 0 ? [{ id: 'github', label: m.issue.github, panel: <GithubLinks issue={issue} /> }] : []),
    ];
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="issue-detail">
        <DetailHeader issue={issue} onClose={onClose} />
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="flex min-w-0 flex-col gap-5">
            {heading}
            <IssueProperties issue={issue} layout="inline" />
            <DescriptionEditor issue={issue} />
            <Section title={m.issue.subIssues}>
              <SubIssues issue={issue} />
            </Section>
            <Section title={m.issue.relations}>
              <Relations issue={issue} />
            </Section>
            <div className="px-1">
              <Tabs aria-label={m.issue.activity} items={tabs} defaultValue="comments" />
            </div>
            {footer}
          </div>
        </div>
      </div>
    );
  }

  // Full page (U1): header in the content region, a ≈720px reading column, a 300px sidebar.
  const rollup = issue.subIssueRollup;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="issue-detail">
      <IssuePageHeader issue={issue} />
      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-auto" data-testid="issue-main">
          <div className="mx-auto flex w-full max-w-180 min-w-0 flex-col gap-6 px-5 py-8 md:px-8">
            {heading}
            {/* Below lg the sidebar folds into the main column, under the title. */}
            {!wide ? <IssueProperties issue={issue} layout="inline" /> : null}
            <DescriptionEditor issue={issue} />
            <Section title={m.issue.subIssues} count={rollup.total > 0 ? m.issue.subIssueRollup(rollup.done, rollup.total) : undefined}>
              <SubIssues issue={issue} />
            </Section>
            <Section title={m.issue.relations}>
              <Relations issue={issue} />
            </Section>
            <Section title={m.issuePage.attachments}>
              <Attachments issue={issue} />
            </Section>
            {issue.githubLinks.length > 0 ? (
              <Section title={m.issuePage.linkedCode}>
                <GithubLinks issue={issue} />
              </Section>
            ) : null}
            <section className="flex flex-col gap-3 border-t border-border pt-6" aria-labelledby="issue-activity-heading">
              <div className="flex h-7 items-center justify-between px-1">
                <h2 id="issue-activity-heading" className="text-md font-semibold text-fg">
                  {m.issuePage.activity}
                </h2>
                <SubscribeToggle issue={issue} />
              </div>
              <ActivityTimeline issueId={issue.id} />
            </section>
            {footer}
          </div>
        </div>
        {wide ? (
          <aside
            className="scrollbar-thin w-75 shrink-0 overflow-y-auto border-l border-border bg-surface px-3 py-4"
            aria-label={m.issuePage.properties}
            data-testid="issue-sidebar"
          >
            {team ? (
              <div className="mb-2 flex min-w-0 items-center gap-2">
                <span className="w-24 shrink-0 pl-2 text-sm text-fg-subtlest">{m.issue.team}</span>
                <span className="flex h-7 min-w-0 items-center gap-2 px-2 text-base text-fg">
                  <TeamIcon team={team} />
                  <span className="truncate">{team.name}</span>
                </span>
              </div>
            ) : null}
            <IssueProperties issue={issue} layout="inline" grouped />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
