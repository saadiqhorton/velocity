import { useEffect, useState } from 'react';
import { useApolloClient } from '@apollo/client';
import { Icon, Menu, MenuItem, MenuSeparator, Popover, SubMenu } from '@velocity/ui';
import type { IssueRowFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { readIssueRow } from '@/lib/issueCache';
import { useUi } from '@/stores/ui';
import { useMoveIssue, useArchiveIssues } from '@/components/issues/actions';
import { TeamIcon } from '@/components/common/EntityIcons';
import { m } from '@/i18n';

/** Returns focus to where it was when the menu opened (SPEC §4.12 focus rules). */
function FocusReturn() {
  const [previous] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (previous && document.contains(previous) && (!active || active === document.body)) previous.focus({ preventScroll: true });
      });
    },
    [previous],
  );
  return null;
}

/**
 * `V` — issue context menu (SPEC §4.12). Reuses the shared pickers for properties and offers
 * an explicit "Move to team" submenu that calls `moveIssue` for the selected target(s).
 */
export function IssueContextMenu() {
  const req = useUi((s) => s.contextMenu);
  const close = useUi((s) => s.closeContextMenu);
  const openPicker = useUi((s) => s.openPicker);
  const askDelete = useUi((s) => s.askDelete);
  const client = useApolloClient();
  const ws = useWorkspace();
  const move = useMoveIssue();
  const archive = useArchiveIssues();
  if (!req) return null;

  const ids = req.issueIds;
  const rows = ids.map((id) => readIssueRow(client.cache, id)).filter((r): r is IssueRowFieldsFragment => r !== null);
  const first = rows[0];
  const currentTeamId = rows.length && rows.every((r) => r.teamId === rows[0]!.teamId) ? rows[0]!.teamId : null;
  const anchor = req.anchor;

  const pick = (kind: Parameters<typeof openPicker>[0]['kind']) => () => {
    close();
    openPicker({ kind, issueIds: ids, anchor });
  };

  return (
    <>
      <FocusReturn />
      <Popover anchorEl={anchor} open placement="bottom-start" onDismiss={close} className="py-0">
        <Menu aria-label={m.issue.contextMenu} autoFocus>
          <MenuItem icon={<Icon name="active" />} onSelect={pick('status')} shortcut="S">
            {m.issue.status}
          </MenuItem>
          <MenuItem icon={<Icon name="user" />} onSelect={pick('assignee')} shortcut="A">
            {m.issue.assignee}
          </MenuItem>
          <MenuItem icon={<Icon name="priority-medium" />} onSelect={pick('priority')} shortcut="P">
            {m.issue.priority}
          </MenuItem>
          <MenuItem icon={<Icon name="label" />} onSelect={pick('labels')} shortcut="L">
            {m.issue.labels}
          </MenuItem>
          <MenuSeparator />
          <SubMenu label={m.cmd.moveIssue} icon={<Icon name="team" />}>
            {ws.teams.map((team) => (
              <MenuItem
                key={team.id}
                icon={<TeamIcon team={team} />}
                disabled={team.id === currentTeamId}
                onSelect={() => {
                  close();
                  void move(ids, team.id);
                }}
              >
                {team.name}
              </MenuItem>
            ))}
          </SubMenu>
          <MenuItem icon={<Icon name="archive" />} onSelect={() => {
            close();
            void archive(ids);
          }} shortcut="Y">
            {m.cmd.archive}
          </MenuItem>
          <MenuItem
            icon={<Icon name="link" />}
            onSelect={() => {
              const row = first;
              close();
              if (row) void navigator.clipboard?.writeText(`${window.location.origin}/issue/${row.identifier}`);
            }}
          >
            {m.cmd.copyUrl}
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger icon={<Icon name="trash" />} onSelect={() => {
            close();
            askDelete(ids);
          }} shortcut="#">
            {m.cmd.delete}
          </MenuItem>
        </Menu>
      </Popover>
    </>
  );
}
