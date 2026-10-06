import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, DropdownMenu, Icon, IconButton, MenuItem, MenuSeparator } from '@velocity/ui';
import { useWorkspace } from '@/app/workspace';
import { useCommands } from '@/keyboard/react';
import { useSidebar } from '@/stores/sidebar';
import { useSelection } from '@/stores/selection';
import { enabledTools, useCodingTools } from '@/stores/codingTools';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { ShortcutHint } from '@/components/common/ShortcutHint';
import { useIssueAi } from '@/components/issues/useIssueAi';
import { COPY_PROMPT_KEYS, IssueMenuItems } from '@/components/overlays/IssueMenuItems';
import { useIssueStepper } from './useIssueStepper';
import type { DetailIssue } from './IssueDetail';
import { m } from '@/i18n';

/** Space and ⌫ go back only from the page itself, never from a field or a control. */
function pageKeyTarget(): boolean {
  const a = document.activeElement;
  if (!a || a === document.body) return true;
  if (a.closest('input, textarea, select, [contenteditable="true"], button, a[href], [role="menuitem"], [role="option"]')) return false;
  return true;
}

/** "Copy as prompt" with an "Open in ▸ tools" dropdown beside it (U1/U3). */
export function PromptSplitButton({ issueId, compact = false }: { issueId: string; compact?: boolean }) {
  const ai = useIssueAi();
  const navigate = useNavigate();
  const tools = enabledTools(useCodingTools((s) => s.tools));
  return (
    <div className="flex shrink-0 items-center" role="group" aria-label={m.ai.copyPrompt}>
      <Button
        size="sm"
        variant="default"
        iconBefore={<Icon name="prompt" />}
        onClick={() => void ai.copyPrompt(issueId)}
        aria-keyshortcuts="Control+Alt+P Meta+Alt+P"
        className="rounded-r-none"
        data-testid="copy-prompt"
      >
        <span className={compact ? 'sr-only' : 'hidden lg:inline'}>{m.ai.copyPrompt}</span>
      </Button>
      <DropdownMenu
        aria-label={m.ai.promptOptions}
        placement="bottom-end"
        trigger={
          <IconButton
            label={m.ai.promptOptions}
            size="sm"
            variant="default"
            icon={<Icon name="chevron-down" className="h-3 w-3" />}
            className="-ml-px rounded-l-none"
            data-testid="prompt-options"
          />
        }
      >
        <MenuItem icon={<Icon name="prompt" />} onSelect={() => void ai.copyPrompt(issueId)} shortcut={<ShortcutHint binding={COPY_PROMPT_KEYS} />}>
          {m.ai.copyPrompt}
        </MenuItem>
        <MenuSeparator />
        <div className="px-3 pb-1 pt-1.5 text-xs font-semibold uppercase text-fg-subtle" aria-hidden="true">
          {m.ai.openIn}
        </div>
        {tools.map((tool) => (
          <MenuItem
            key={tool.id}
            icon={<Icon name={tool.kind === 'command' ? 'terminal' : 'external-link'} />}
            onSelect={() => void ai.launch(tool, issueId)}
            shortcut={tool.shortcut ? <ShortcutHint binding={tool.shortcut} /> : undefined}
          >
            {m.cmd.openInTool(tool.name)}
          </MenuItem>
        ))}
        {tools.length === 0 ? <MenuItem disabled>{m.ai.noTools}</MenuItem> : null}
        <MenuSeparator />
        <MenuItem icon={<Icon name="settings" />} onSelect={() => navigate('/settings/coding-tools')}>
          {m.ai.configureTools}
        </MenuItem>
      </DropdownMenu>
    </div>
  );
}

/**
 * The issue page's header (U1): it belongs to the content region like a list's view header
 * (SPEC §4.10.2, no top bar). Breadcrumb, favorite and ⋯ on the left; copy actions, the
 * prompt split button and `n / total` stepping on the right.
 */
export function IssuePageHeader({ issue }: { issue: DetailIssue }) {
  const { workspace } = useWorkspace();
  const ai = useIssueAi();
  const stepper = useIssueStepper(issue);
  const setDrawerOpen = useSidebar((s) => s.setDrawerOpen);
  const [moreEl, setMoreEl] = useState<HTMLButtonElement | null>(null);

  useCommands(() => [
    { id: 'page.next', title: m.cmd.nextIssue, group: 'list', keys: ['j', 'arrowdown'], repeat: true, when: () => stepper.canNext, run: stepper.next },
    { id: 'page.prev', title: m.cmd.previousIssue, group: 'list', keys: ['k', 'arrowup'], repeat: true, when: () => stepper.canPrev, run: stepper.prev },
    { id: 'page.back', title: m.cmd.backToList, group: 'navigation', keys: ['backspace'], palette: false, when: pageKeyTarget, run: stepper.back },
    {
      id: 'page.escape',
      title: m.cmd.backToList,
      group: 'navigation',
      keys: ['escape'],
      palette: false,
      when: () => !new URLSearchParams(window.location.search).has('issue') && useSelection.getState().selected.size === 0,
      run: stepper.back,
    },
  ]);

  return (
    <header data-testid="issue-page-header" className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3 sm:gap-2 sm:px-5">
      <IconButton label={m.nav.openMenu} size="sm" icon={<Icon name="sidebar" />} className="md:hidden" onClick={() => setDrawerOpen(true)} />
      <nav aria-label={m.issuePage.breadcrumb} className="flex min-w-0 shrink items-center gap-1 overflow-hidden text-base">
        <Link to="/" className="hidden shrink-0 truncate text-fg-subtle hover:text-fg sm:inline">
          {workspace?.name}
        </Link>
        <span className="hidden shrink-0 sm:flex" aria-hidden="true">
          <Icon name="chevron-right" className="h-3 w-3 text-fg-subtlest" />
        </span>
        <Link
          to={stepper.backTo}
          onClick={(e) => {
            e.preventDefault();
            stepper.back();
          }}
          className="hidden max-w-48 shrink-0 truncate text-fg-subtle hover:text-fg sm:inline"
          data-testid="issue-breadcrumb-list"
        >
          {stepper.backLabel}
        </Link>
        <span className="hidden shrink-0 sm:flex" aria-hidden="true">
          <Icon name="chevron-right" className="h-3 w-3 text-fg-subtlest" />
        </span>
        <span aria-current="page" className="flex min-w-0 items-center gap-2">
          <span className="identifier shrink-0" data-testid="issue-identifier">
            {issue.identifier}
          </span>
          <span className="hidden min-w-0 truncate text-fg md:inline">{issue.title}</span>
        </span>
      </nav>
      <FavoriteButton kind="issue" targetId={issue.id} size="sm" className="shrink-0" />
      <DropdownMenu
        aria-label={m.issuePage.actions}
        placement="bottom-start"
        trigger={<IconButton ref={setMoreEl} label={m.issuePage.actions} size="sm" icon={<Icon name="more" />} data-testid="issue-more" />}
      >
        <IssueMenuItems issueIds={[issue.id]} anchor={moreEl} />
      </DropdownMenu>
      <span className="flex-1" />
      <div role="toolbar" aria-label={m.issuePage.toolbar} className="flex shrink-0 items-center gap-1">
        <span className="hidden items-center gap-1 md:flex">
          <IconButton label={m.ai.copyLink} size="sm" icon={<Icon name="link" />} onClick={() => void ai.copyLink(issue.id)} aria-keyshortcuts="Control+Shift+Comma Meta+Shift+Comma" data-testid="copy-link" />
          <IconButton label={m.ai.copyId} size="sm" icon={<Icon name="hashtag" />} onClick={() => void ai.copyId(issue.id)} aria-keyshortcuts="Control+Period Meta+Period" data-testid="copy-id" />
          <IconButton label={m.ai.copyBranch} size="sm" icon={<Icon name="branch" />} onClick={() => void ai.copyBranch(issue.id)} aria-keyshortcuts="Control+Shift+Period Meta+Shift+Period" data-testid="copy-branch" />
        </span>
        <PromptSplitButton issueId={issue.id} />
      </div>
      {stepper.position !== null ? (
        <div className="flex shrink-0 items-center gap-0.5 border-l border-border pl-1 sm:gap-1 sm:pl-2" data-testid="issue-stepper">
          <span className="hidden whitespace-nowrap px-1 text-sm tabular-nums text-fg-subtle sm:inline" aria-label={m.issuePage.positionLabel(stepper.position, stepper.total)}>
            {m.issuePage.position(stepper.position, stepper.total)}
          </span>
          <IconButton label={m.issuePage.previous} size="sm" icon={<Icon name="chevron-up" />} disabled={!stepper.canPrev} onClick={stepper.prev} aria-keyshortcuts="K ArrowUp" data-testid="issue-prev" />
          <IconButton label={m.issuePage.next} size="sm" icon={<Icon name="chevron-down" />} disabled={!stepper.canNext} onClick={stepper.next} aria-keyshortcuts="J ArrowDown" data-testid="issue-next" />
        </div>
      ) : null}
    </header>
  );
}
