import { useApolloClient } from '@apollo/client';
import { useFlags } from '@velocity/ui';
import { useWorkspace } from '@/app/workspace';
import { useCommands } from '@/keyboard/react';
import { readIssueRow } from '@/lib/issueCache';
import { useOpenIssue } from '@/lib/navigation';
import { targetAnchor, targetIssueIds } from '@/lib/targets';
import { useUi } from '@/stores/ui';
import type { PickerKind } from '@/stores/ui';
import { useArchiveIssues, useDuplicateIssue, useToggleDone, useUpdateIssues } from '@/components/issues/actions';
import { useIssueAi } from '@/components/issues/useIssueAi';
import { COPY_BRANCH_KEYS, COPY_ID_KEYS, COPY_LINK_KEYS, COPY_PROMPT_KEYS } from '@/components/overlays/IssueMenuItems';
import { enabledTools, useCodingTools } from '@/stores/codingTools';
import { useFeatures } from '@/lib/features';
import { m } from '@/i18n';

const hasTargets = () => targetIssueIds().length > 0;

/** Issue action shortcuts (SPEC §4.12): E, I, A, L, P, S, M, R, Y, # and palette-only extras. */
export function IssueCommands() {
  const { viewer } = useWorkspace();
  const client = useApolloClient();
  const { showFlag } = useFlags();
  const openPicker = useUi((s) => s.openPicker);
  const openContextMenu = useUi((s) => s.openContextMenu);
  const askDelete = useUi((s) => s.askDelete);
  const update = useUpdateIssues();
  const toggleDone = useToggleDone();
  const archive = useArchiveIssues();
  const duplicate = useDuplicateIssue();
  const openIssue = useOpenIssue();

  const picker = (kind: PickerKind, property?: string) => () => {
    const ids = targetIssueIds();
    if (ids.length > 0) openPicker({ kind, issueIds: ids, anchor: targetAnchor(property ?? kind) });
  };

  const ai = useIssueAi();
  const features = useFeatures();
  const tools = enabledTools(useCodingTools((s) => s.tools));
  const single = () => targetIssueIds().length === 1;
  const withSingle = (fn: (id: string) => Promise<unknown>) => () => {
    const id = targetIssueIds()[0];
    if (id) void fn(id);
  };

  useCommands(() => [
    { id: 'issue.done', title: m.cmd.markDone, group: 'issue', keys: ['e'], when: hasTargets, run: () => void toggleDone(targetIssueIds()) },
    {
      id: 'issue.assignMe',
      title: m.cmd.assignMe,
      group: 'issue',
      keys: ['i'],
      when: hasTargets,
      run: () => {
        const ids = targetIssueIds();
        const allMine = ids.every((id) => readIssueRow(client.cache, id)?.assigneeId === viewer.id);
        void update(ids, { assigneeId: allMine ? null : viewer.id });
      },
    },
    { id: 'issue.assign', title: m.cmd.assign, group: 'issue', keys: ['a'], when: hasTargets, run: picker('assignee') },
    { id: 'issue.label', title: m.cmd.label, group: 'issue', keys: ['l'], when: hasTargets, run: picker('labels') },
    { id: 'issue.priority', title: m.cmd.priority, group: 'issue', keys: ['p'], when: hasTargets, run: picker('priority') },
    { id: 'issue.status', title: m.cmd.status, group: 'issue', keys: ['s'], when: hasTargets, run: picker('status') },
    { id: 'issue.moveTeam', title: m.cmd.moveTeam, group: 'issue', keys: ['m'], when: hasTargets, run: picker('team') },
    {
      id: 'issue.contextMenu',
      title: m.cmd.moveIssue,
      group: 'issue',
      keys: ['v'],
      when: hasTargets,
      run: () => {
        const ids = targetIssueIds();
        if (ids.length > 0) openContextMenu({ issueIds: ids, anchor: targetAnchor() });
      },
    },
    { id: 'issue.relation', title: m.cmd.relation, group: 'issue', keys: ['r'], when: () => targetIssueIds().length === 1, run: picker('relation') },
    { id: 'issue.project', title: m.cmd.project, group: 'issue', when: hasTargets, run: picker('project') },
    { id: 'issue.cycle', title: m.cmd.cycle, group: 'issue', when: () => features.cycles && hasTargets(), run: picker('cycle') },
    { id: 'issue.estimate', title: m.cmd.estimate, group: 'issue', when: () => features.estimates && hasTargets(), run: picker('estimate') },
    { id: 'issue.archive', title: m.cmd.archive, group: 'issue', keys: ['y'], when: hasTargets, run: () => void archive(targetIssueIds()) },
    { id: 'issue.delete', title: m.cmd.delete, group: 'issue', keys: ['#'], when: hasTargets, run: () => askDelete(targetIssueIds()) },
    {
      id: 'issue.duplicate',
      title: m.cmd.duplicate,
      group: 'issue',
      when: () => targetIssueIds().length === 1,
      run: () => {
        const id = targetIssueIds()[0];
        if (!id) return;
        void duplicate({ id }).then((r) => {
          const copyRow = r.data?.duplicateIssue;
          if (copyRow) showFlag({ title: m.issue.duplicated(copyRow.identifier), severity: 'success', action: { label: m.common.open, onClick: () => openIssue(copyRow.id) } });
        });
      },
    },
    {
      id: 'issue.menu',
      title: m.cmd.contextMenu,
      group: 'issue',
      keys: ['shift+f10', 'contextmenu'],
      palette: false,
      when: hasTargets,
      run: () => {
        const ids = targetIssueIds();
        if (ids.length > 0) openContextMenu({ issueIds: ids, anchor: targetAnchor() });
      },
    },
    // Copy actions (Roadmap v1.2 U2): work on the page, a focused row, the peek panel and the palette.
    { id: 'issue.copyPrompt', title: m.cmd.copyPrompt, group: 'issue', keys: [COPY_PROMPT_KEYS], allowInInput: true, keywords: ['ai', 'agent', 'prompt'], when: single, run: withSingle(ai.copyPrompt) },
    { id: 'issue.copyBranch', title: m.cmd.copyBranch, group: 'issue', keys: [COPY_BRANCH_KEYS], allowInInput: true, keywords: ['git'], when: single, run: withSingle(ai.copyBranch) },
    { id: 'issue.copyId', title: m.cmd.copyId, group: 'issue', keys: [COPY_ID_KEYS], allowInInput: true, when: single, run: withSingle(ai.copyId) },
    { id: 'issue.copyUrl', title: m.cmd.copyUrl, group: 'issue', keys: [COPY_LINK_KEYS], allowInInput: true, when: single, run: withSingle(ai.copyLink) },
    ...tools.map((tool, i) => ({
      id: `issue.openIn.${tool.id}`,
      title: m.cmd.openInTool(tool.name),
      group: 'issue' as const,
      keys: tool.shortcut ? [tool.shortcut] : undefined,
      allowInInput: true,
      keywords: ['ai', 'agent', 'open in', i === 0 ? 'first' : ''].filter(Boolean),
      when: single,
      run: withSingle((id) => ai.launch(tool, id)),
    })),
  ]);
  return null;
}
