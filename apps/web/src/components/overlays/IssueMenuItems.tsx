import { useNavigate } from 'react-router-dom';
import { useApolloClient } from '@apollo/client';
import { Icon, MenuItem, MenuSeparator, SubMenu } from '@velocity/ui';
import type { IssueRowFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { readIssueRow } from '@/lib/issueCache';
import { useUi } from '@/stores/ui';
import type { PickerKind } from '@/stores/ui';
import { enabledTools, useCodingTools } from '@/stores/codingTools';
import { useArchiveIssues, useDuplicateIssue, useMoveIssue } from '@/components/issues/actions';
import { useIssueAi } from '@/components/issues/useIssueAi';
import { TeamIcon } from '@/components/common/EntityIcons';
import { ShortcutHint } from '@/components/common/ShortcutHint';
import { m } from '@/i18n';

export const COPY_PROMPT_KEYS = 'mod+alt+p';
export const COPY_BRANCH_KEYS = 'mod+shift+.';
export const COPY_ID_KEYS = 'mod+.';
export const COPY_LINK_KEYS = 'mod+shift+,';

export interface IssueMenuItemsProps {
  issueIds: string[];
  /** Element pickers anchor to (the row, the ⋯ button). */
  anchor: HTMLElement | null;
  /** Called before each action; the context menu closes itself here. */
  onAction?: () => void;
}

/**
 * The issue actions (U2), shared by the right-click / `V` / Shift+F10 context menu and the
 * issue page's ⋯ menu: properties, copy, open in, move, archive, delete.
 */
export function IssueMenuItems({ issueIds, anchor, onAction }: IssueMenuItemsProps) {
  const client = useApolloClient();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const openPicker = useUi((s) => s.openPicker);
  const askDelete = useUi((s) => s.askDelete);
  const move = useMoveIssue();
  const archive = useArchiveIssues();
  const duplicate = useDuplicateIssue();
  const ai = useIssueAi();
  const tools = enabledTools(useCodingTools((s) => s.tools));

  const ids = issueIds;
  const single = ids.length === 1 ? ids[0] : undefined;
  const rows = ids.map((id) => readIssueRow(client.cache, id)).filter((r): r is IssueRowFieldsFragment => r !== null);
  const currentTeamId = rows.length > 0 && rows.every((r) => r.teamId === rows[0]?.teamId) ? (rows[0]?.teamId ?? null) : null;

  const act = (fn: () => void) => () => {
    onAction?.();
    fn();
  };
  const pick = (kind: PickerKind) => act(() => openPicker({ kind, issueIds: ids, anchor }));

  return (
    <>
      <MenuItem icon={<Icon name="active" />} onSelect={pick('status')} shortcut={<ShortcutHint binding="s" />}>
        {m.issue.status}
      </MenuItem>
      <MenuItem icon={<Icon name="priority-medium" />} onSelect={pick('priority')} shortcut={<ShortcutHint binding="p" />}>
        {m.issue.priority}
      </MenuItem>
      <MenuItem icon={<Icon name="user" />} onSelect={pick('assignee')} shortcut={<ShortcutHint binding="a" />}>
        {m.issue.assignee}
      </MenuItem>
      <MenuItem icon={<Icon name="label" />} onSelect={pick('labels')} shortcut={<ShortcutHint binding="l" />}>
        {m.issue.labels}
      </MenuItem>
      <MenuItem icon={<Icon name="project" />} onSelect={pick('project')}>
        {m.issue.project}
      </MenuItem>
      {single ? (
        <>
          <MenuSeparator />
          <SubMenu label={m.ai.copySubmenu} icon={<Icon name="copy" />}>
            <MenuItem icon={<Icon name="prompt" />} onSelect={act(() => void ai.copyPrompt(single))} shortcut={<ShortcutHint binding={COPY_PROMPT_KEYS} />}>
              {m.ai.copyPrompt}
            </MenuItem>
            <MenuItem icon={<Icon name="branch" />} onSelect={act(() => void ai.copyBranch(single))} shortcut={<ShortcutHint binding={COPY_BRANCH_KEYS} />}>
              {m.ai.copyBranch}
            </MenuItem>
            <MenuItem icon={<Icon name="hashtag" />} onSelect={act(() => void ai.copyId(single))} shortcut={<ShortcutHint binding={COPY_ID_KEYS} />}>
              {m.ai.copyId}
            </MenuItem>
            <MenuItem icon={<Icon name="link" />} onSelect={act(() => void ai.copyLink(single))} shortcut={<ShortcutHint binding={COPY_LINK_KEYS} />}>
              {m.ai.copyLink}
            </MenuItem>
          </SubMenu>
          <SubMenu label={m.ai.openIn} icon={<Icon name="terminal" />}>
            {tools.map((tool) => (
              <MenuItem
                key={tool.id}
                icon={<Icon name={tool.kind === 'command' ? 'terminal' : 'external-link'} />}
                onSelect={act(() => void ai.launch(tool, single))}
                shortcut={tool.shortcut ? <ShortcutHint binding={tool.shortcut} /> : undefined}
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
      <MenuItem icon={<Icon name="archive" />} onSelect={act(() => void archive(ids))} shortcut={<ShortcutHint binding="y" />}>
        {m.cmd.archive}
      </MenuItem>
      <MenuSeparator />
      <MenuItem danger icon={<Icon name="trash" />} onSelect={act(() => askDelete(ids))} shortcut={<ShortcutHint binding="#" />}>
        {m.cmd.delete}
      </MenuItem>
    </>
  );
}
