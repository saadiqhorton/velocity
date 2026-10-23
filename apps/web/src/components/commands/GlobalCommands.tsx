import { useLocation, useNavigate } from 'react-router-dom';
import { useApolloClient } from '@apollo/client';
import { LogoutDocument } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useCommands } from '@/keyboard/react';
import type { Command } from '@/keyboard/engine';
import { useOptimisticMutation } from '@/lib/mutation';
import { useClosePanel, usePanelIssueId } from '@/lib/navigation';
import { useActiveList } from '@/stores/list';
import { useDetailIssue } from '@/stores/detail';
import { useSelection } from '@/stores/selection';
import { useTheme } from '@/stores/theme';
import { useUi } from '@/stores/ui';
import { useSetTheme } from '@/components/shell/theme';
import { teamUsesCycles, useFeatures } from '@/lib/features';
import { m } from '@/i18n';

/** Team context for G-chords: route → active list → open issue → first team. */
function useCurrentTeamKey(): () => string | null {
  const { teams, teamsById } = useWorkspace();
  const location = useLocation();
  return () => {
    const match = /^\/team\/([^/]+)/.exec(location.pathname);
    if (match?.[1]) return match[1].toUpperCase();
    const ctxTeam = useActiveList.getState().context?.teamId ?? useDetailIssue.getState().teamId;
    if (ctxTeam) return teamsById.get(ctxTeam)?.key ?? null;
    return teams[0]?.key ?? null;
  };
}

/** Global commands (SPEC §4.12, §4.13): palette, create, search, help, G-chords, theme. */
export function GlobalCommands() {
  const navigate = useNavigate();
  const client = useApolloClient();
  const ws = useWorkspace();
  const features = useFeatures();
  const ui = useUi();
  const teamKey = useCurrentTeamKey();
  const panelIssue = usePanelIssueId();
  const closePanel = useClosePanel();
  const setTheme = useSetTheme();
  const [logout] = useOptimisticMutation(LogoutDocument, {
    optimistic: { serverConfirmed: 'Session cookies are cleared by the server response.' },
    rollback: () => m.flags.rollback.generic,
  });

  const goTeam = (path: string) => {
    const key = teamKey();
    if (key) navigate(`/team/${key}/${path}`);
  };

  const teamNav: Command[] = ws.teams.flatMap((t) => [
    {
      id: `nav.team.${t.id}.active`,
      title: m.palette.goTo(`${t.name} · ${m.nav.active}`),
      group: 'navigation' as const,
      keywords: [t.key],
      icon: 'active' as const,
      run: () => navigate(`/team/${t.key}/active`),
    },
    {
      id: `nav.team.${t.id}.backlog`,
      title: m.palette.goTo(`${t.name} · ${m.nav.backlog}`),
      group: 'navigation' as const,
      keywords: [t.key],
      icon: 'backlog' as const,
      run: () => navigate(`/team/${t.key}/backlog`),
    },
    ...(teamUsesCycles(features, t)
      ? [
          {
            id: `nav.team.${t.id}.cycles`,
            title: m.palette.goTo(`${t.name} · ${m.nav.cycles}`),
            group: 'navigation' as const,
            keywords: [t.key],
            icon: 'cycle' as const,
            run: () => navigate(`/team/${t.key}/cycles`),
          },
        ]
      : []),
  ]);

  useCommands(
    () => [
      {
        id: 'palette.open',
        title: m.cmd.openPalette,
        group: 'general',
        keys: ['mod+k'],
        allowInInput: true,
        palette: false,
        run: () => (ui.paletteOpen ? ui.closePalette() : ui.openPalette()),
      },
      {
        id: 'issue.create',
        title: m.cmd.createIssue,
        group: 'general',
        keys: ['c'],
        icon: 'add',
        run: () => {
          const ctx = useActiveList.getState().context;
          ui.openCreate({ teamId: ctx?.teamId ?? useDetailIssue.getState().teamId ?? undefined, projectId: ctx?.projectId, cycleId: ctx?.cycleId });
        },
      },
      {
        id: 'search.focus',
        title: m.cmd.focusSearch,
        group: 'general',
        keys: ['/'],
        icon: 'search',
        run: () => {
          const input = document.getElementById('sidebar-search');
          if (input && input.offsetParent !== null) input.focus();
          else navigate('/search');
        },
      },
      { id: 'help.shortcuts', title: m.cmd.showShortcuts, group: 'general', keys: ['?'], icon: 'keyboard', run: () => ui.setShortcutsOpen(true) },
      {
        id: 'escape',
        title: m.cmd.close,
        group: 'general',
        keys: ['escape'],
        palette: false,
        // On the issue page, Esc with nothing else to close returns to the list (IssuePageHeader).
        when: () => Boolean(panelIssue) || useSelection.getState().selected.size > 0,
        run: () => {
          if (panelIssue) closePanel();
          else useSelection.getState().clear();
        },
      },
      { id: 'go.backlog', title: m.cmd.goBacklog, group: 'navigation', keys: ['g b'], icon: 'backlog', run: () => goTeam('backlog') },
      { id: 'go.inbox', title: m.cmd.goInbox, group: 'navigation', keys: ['g i'], icon: 'inbox', run: () => navigate('/inbox') },
      { id: 'go.myIssues', title: m.cmd.goMyIssues, group: 'navigation', keys: ['g m'], icon: 'my-issues', run: () => navigate('/my-issues') },
      { id: 'go.all', title: m.cmd.goAll, group: 'navigation', keys: ['g a'], icon: 'list', run: () => navigate('/issues') },
      { id: 'go.projects', title: m.cmd.goProjects, group: 'navigation', keys: ['g p'], icon: 'project', run: () => navigate('/projects') },
      { id: 'go.settings', title: m.cmd.goSettings, group: 'navigation', keys: ['g s'], icon: 'settings', run: () => navigate('/settings') },
      { id: 'go.cycle', title: m.cmd.goCycle, group: 'navigation', keys: ['g t'], icon: 'cycle', when: () => features.cycles, run: () => goTeam('cycles') },
      { id: 'go.active', title: m.cmd.goActive, group: 'navigation', keys: ['g c'], icon: 'active', run: () => goTeam('active') },
      { id: 'go.views', title: m.cmd.goViews, group: 'navigation', keys: ['g v'], icon: 'view', run: () => navigate('/views') },
      { id: 'go.insights', title: m.cmd.goInsights, group: 'navigation', icon: 'chart', when: () => features.insights, run: () => navigate('/insights') },
      {
        id: 'theme.toggle',
        title: m.cmd.toggleTheme,
        group: 'general',
        keywords: ['dark', 'light'],
        icon: 'moon',
        run: () => setTheme(useTheme.getState().resolved === 'dark' ? 'light' : 'dark'),
      },
      { id: 'team.create', title: m.cmd.newTeam, group: 'general', icon: 'team', run: () => navigate('/settings/teams/new') },
      { id: 'project.create', title: m.cmd.newProject, group: 'general', icon: 'project', run: () => navigate('/projects?new=1') },
      { id: 'view.create', title: m.cmd.newView, group: 'general', icon: 'view', run: () => navigate('/view/new') },
      {
        id: 'session.logout',
        title: m.cmd.logout,
        group: 'general',
        icon: 'logout',
        run: () =>
          void logout({}).then(async () => {
            await client.clearStore();
            navigate('/login', { replace: true });
          }),
      },
      ...teamNav,
    ],
    [
      'palette.open',
      'issue.create',
      'search.focus',
      'help.shortcuts',
      'escape',
      'go.backlog',
      'go.inbox',
      'go.myIssues',
      'go.all',
      'go.projects',
      'go.settings',
      'go.cycle',
      'go.active',
      'go.views',
      'go.insights',
      'theme.toggle',
      'team.create',
      'project.create',
      'view.create',
      'session.logout',
      ...teamNav.map((c) => c.id),
    ],
  );
  return null;
}
