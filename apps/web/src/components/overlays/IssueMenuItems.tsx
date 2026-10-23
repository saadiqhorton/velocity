import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApolloClient } from '@apollo/client';
import { Icon, MenuItem, MenuSeparator, OptionSubMenu, StatusIcon, SubMenu } from '@velocity/ui';
import { IssueDetailDocument } from '@/gql/graphql';
import type { IssueRowFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { readIssueRow } from '@/lib/issueCache';
import { teamUsesCycles, useFeatures } from '@/lib/features';
import { engine } from '@/keyboard/react';
import { useUi } from '@/stores/ui';
import type { PickerKind } from '@/stores/ui';
import { enabledTools, useCodingTools } from '@/stores/codingTools';
import { useArchiveIssues, useDuplicateIssue, useMoveIssue, useSetSubscribed } from '@/components/issues/actions';
import { issueLink, useIssueAi } from '@/components/issues/useIssueAi';
import { TeamIcon } from '@/components/common/EntityIcons';
import { ShortcutHint } from '@/components/common/ShortcutHint';
import { m } from '@/i18n';
import { usePickerSpec } from './usePickerSpec';

export const COPY_PROMPT_KEYS = 'mod+alt+p';
export const COPY_BRANCH_KEYS = 'mod+shift+.';
export const COPY_ID_KEYS = 'mod+.';
export const COPY_LINK_KEYS = 'mod+shift+,';

export interface IssueMenuItemsProps {
  issueIds: string[];
  /** Called before each action; the context menu closes itself here. */
  onAction?: () => void;
}

/** The shortcut shown next to an item: the binding the command registry actually runs (so menus cannot drift). */
function hintFor(commandId: string): ReactNode {
  const binding = engine.get(commandId)?.keys?.[0];
  return binding ? <ShortcutHint binding={binding} /> : undefined;
}

interface PropertyMenuProps {
  kind: PickerKind;
  issueIds: string[];
  icon: ReactNode;
  shortcut?: ReactNode;
  searchable?: boolean;
  onAction?: () => void;
}

/** A property submenu (Status ›, Labels ›…) with the picker's own options, applied through the picker's commit. */
function PropertyMenu({ kind, issueIds, icon, shortcut, searchable, onAction }: PropertyMenuProps) {
  const spec = usePickerSpec(kind, issueIds);
  if (!spec) return null;
  if (spec.multiple) {
    // Labels: each toggle applies and the menu stays open.
    return <OptionSubMenu label={spec.label} icon={icon} shortcut={shortcut} options={spec.options} searchable={searchable} multiple value={spec.value} onChange={spec.commit} />;
  }
  return (
    <OptionSubMenu
      label={spec.label}
      icon={icon}
      shortcut={shortcut}
      options={spec.options}
      searchable={searchable}
      value={spec.value}
      onChange={(v) => {
        onAction?.();
        spec.commit(v);
      }}
    />
  );
}

/** The Status item's icon: the single target's own status glyph; several targets get the neutral backlog mark. */
function statusMenuIcon(target: IssueRowFieldsFragment | undefined): ReactNode {
  return target ? <StatusIcon category={target.status.category} color={target.status.color} label="" /> : <Icon name="backlog" />;
}

/**
 * The issue actions (U2), shared by the right-click / `V` / Shift+F10 context menu and the
 * issue page's ⋯ menu: properties, copy, open in, move, archive, delete.
 */
export function IssueMenuItems({ issueIds, onAction }: IssueMenuItemsProps) {
  const client = useApolloClient();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const askDelete = useUi((s) => s.askDelete);
  const move = useMoveIssue();
  const archive = useArchiveIssues();
  const duplicate = useDuplicateIssue();
  const setSubscribed = useSetSubscribed();
  const ai = useIssueAi();
  const features = useFeatures();
  const tools = enabledTools(useCodingTools((s) => s.tools));

  const ids = issueIds;
  const single = ids.length === 1 ? ids[0] : undefined;
  const rows = ids.map((id) => readIssueRow(client.cache, id)).filter((r): r is IssueRowFieldsFragment => r !== null);
  const currentTeamId = rows.length > 0 && rows.every((r) => r.teamId === rows[0]?.teamId) ? (rows[0]?.teamId ?? null) : null;
  // Cycles follow the first target's team, as the pickers do.
  const targetTeam = rows[0] ? ws.teamsById.get(rows[0].teamId) : undefined;
  // `subscribed` is not in the row fragment: it is cached once this issue's page or peek panel has loaded the detail.
  const subscribed = single ? client.readQuery({ query: IssueDetailDocument, variables: { id: single } })?.issue?.subscribed : undefined;

  const act = (fn: () => void) => () => {
    onAction?.();
    fn();
  };

  return (
    <>
      <PropertyMenu kind="status" issueIds={ids} icon={statusMenuIcon(single ? rows[0] : undefined)} shortcut={hintFor('issue.status')} onAction={onAction} />
      <PropertyMenu kind="priority" issueIds={ids} icon={<Icon name="priority-medium" />} shortcut={hintFor('issue.priority')} onAction={onAction} />
      <PropertyMenu kind="assignee" issueIds={ids} icon={<Icon name="user" />} shortcut={hintFor('issue.assign')} searchable onAction={onAction} />
      <PropertyMenu kind="labels" issueIds={ids} icon={<Icon name="label" />} shortcut={hintFor('issue.label')} searchable />
      <PropertyMenu kind="project" issueIds={ids} icon={<Icon name="project" />} searchable onAction={onAction} />
      {teamUsesCycles(features, targetTeam) ? <PropertyMenu kind="cycle" issueIds={ids} icon={<Icon name="cycle" />} onAction={onAction} /> : null}
      {features.estimates ? <PropertyMenu kind="estimate" issueIds={ids} icon={<Icon name="chart" />} onAction={onAction} /> : null}
      {single ? (
        <>
          <MenuSeparator />
          <SubMenu label={m.ai.copySubmenu} icon={<Icon name="copy" />}>
            <MenuItem icon={<Icon name="prompt" />} onSelect={act(() => void ai.copyPrompt(single))} shortcut={hintFor('issue.copyPrompt')}>
              {m.ai.copyPrompt}
            </MenuItem>
            <MenuItem icon={<Icon name="branch" />} onSelect={act(() => void ai.copyBranch(single))} shortcut={hintFor('issue.copyBranch')}>
              {m.ai.copyBranch}
            </MenuItem>
            <MenuItem icon={<Icon name="hashtag" />} onSelect={act(() => void ai.copyId(single))} shortcut={hintFor('issue.copyId')}>
              {m.ai.copyId}
            </MenuItem>
            <MenuItem icon={<Icon name="link" />} onSelect={act(() => void ai.copyLink(single))} shortcut={hintFor('issue.copyUrl')}>
              {m.ai.copyLink}
            </MenuItem>
          </SubMenu>
          <SubMenu label={m.ai.openIn} icon={<Icon name="terminal" />}>
            <MenuItem icon={<Icon name="external-link" />} onSelect={act(() => void window.open(issueLink(single), '_blank', 'noopener'))}>
              {m.ai.openInNewTab}
            </MenuItem>
            <MenuSeparator />
            {tools.map((tool) => (
              <MenuItem
                key={tool.id}
                icon={<Icon name={tool.kind === 'command' ? 'terminal' : 'external-link'} />}
                onSelect={act(() => void ai.launch(tool, single))}
                shortcut={hintFor(`issue.openIn.${tool.id}`)}
              >
                {tool.name}
              </MenuItem>
            ))}
            {tools.length === 0 ? <MenuItem disabled>{m.ai.noTools}</MenuItem> : null}
            <MenuSeparator />
            <MenuItem icon={<Icon name="settings" />} onSelect={act(() => navigate('/settings/coding-tools'))}>
              {m.ai.configureTools}
            </MenuItem>
          </SubMenu>
          {typeof subscribed === 'boolean' ? (
            <MenuItem icon={<Icon name="bell" />} onSelect={act(() => void setSubscribed({ id: single, subscribed: !subscribed }))}>
              {subscribed ? m.issue.unsubscribe : m.issue.subscribe}
            </MenuItem>
          ) : null}
        </>
      ) : null}
      <MenuSeparator />
      <SubMenu label={m.issue.moveToTeam} icon={<Icon name="team" />}>
        {ws.teams.map((team) => (
          <MenuItem key={team.id} icon={<TeamIcon team={team} />} disabled={team.id === currentTeamId} onSelect={act(() => void move(ids, team.id))}>
            {team.name}
          </MenuItem>
        ))}
      </SubMenu>
      {single ? (
        <MenuItem icon={<Icon name="copy" />} onSelect={act(() => void duplicate({ id: single }))}>
          {m.common.duplicate}
        </MenuItem>
      ) : null}
      <MenuItem icon={<Icon name="archive" />} onSelect={act(() => void archive(ids))} shortcut={hintFor('issue.archive')}>
        {m.cmd.archive}
      </MenuItem>
      <MenuSeparator />
      <MenuItem danger icon={<Icon name="trash" />} onSelect={act(() => askDelete(ids))} shortcut={hintFor('issue.delete')}>
        {m.cmd.delete}
      </MenuItem>
    </>
  );
}
