import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { Tabs } from '@velocity/ui';
import { TeamsAdminDocument } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';
import { NotFound } from '@/screens/workspace/NotFound';
import { SettingsPage } from '../common';
import { TeamGeneralTab } from './TeamGeneralTab';
import { TeamWorkflowTab } from './TeamWorkflowTab';
import { TeamCyclesTab } from './TeamCyclesTab';
import { TeamMembersTab } from './TeamMembersTab';
import { useFeatures } from '@/lib/features';
import { m } from '@/i18n';

const TABS = ['general', 'workflow', 'cycles', 'members'] as const;
type TabId = (typeof TABS)[number];
const TAB_LABEL: Record<TabId, () => string> = {
  general: () => m.settingsWorkspace.team.tabGeneral,
  workflow: () => m.settingsWorkspace.team.tabWorkflow,
  cycles: () => m.settingsWorkspace.team.tabCycles,
  members: () => m.settingsWorkspace.team.tabMembers,
};

export function TeamSettings() {
  const t = m.settingsWorkspace.team;
  const { key, '*': rest } = useParams();
  const navigate = useNavigate();
  const { teamsByKey } = useWorkspace();
  const features = useFeatures();
  const upper = key?.toUpperCase();
  const active = upper ? teamsByKey.get(upper) : undefined;
  // Archived teams are not in Bootstrap; look them up separately (only when the key is not active).
  const { data: adminData, loading } = useQuery(TeamsAdminDocument, { skip: active !== undefined });
  const team = active ?? adminData?.teams.find((x) => x.key === upper);
  if (!team) return loading ? <ContentSkeleton rows={8} /> : <NotFound message={t.notFound} />;
  const segment = (rest ?? '').split('/')[0] ?? '';
  // Solo mode (U4): the Cycles and Members tabs hide with their features.
  const shown = TABS.filter((id) => (id !== 'cycles' || features.cycles) && (id !== 'members' || features.members));
  const current: TabId = (shown as readonly string[]).includes(segment) ? (segment as TabId) : 'general';
  const go = (id: string) => navigate(id === 'general' ? `/settings/teams/${team.key}` : `/settings/teams/${team.key}/${id}`);

  const content =
    current === 'general' ? (
      <TeamGeneralTab team={team} />
    ) : current === 'workflow' ? (
      <TeamWorkflowTab team={team} />
    ) : current === 'cycles' ? (
      <TeamCyclesTab team={team} />
    ) : (
      <TeamMembersTab team={team} />
    );

  return (
    <SettingsPage
      title={team.name}
      parents={[{ label: m.settings.sections.teams, to: '/settings/teams' }]}
      testId="settings-team"
    >
      <Tabs
        aria-label={t.tabsLabel}
        value={current}
        onChange={go}
        items={shown.map((id) => ({ id, label: TAB_LABEL[id](), panel: current === id ? <Panel>{content}</Panel> : undefined }))}
      />
    </SettingsPage>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-8 pt-2">{children}</div>;
}
