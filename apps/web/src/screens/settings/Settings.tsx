import { Suspense, lazy } from 'react';
import type { ComponentType } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Icon, SideNav, SideNavItem } from '@velocity/ui';
import type { IconName } from '@velocity/ui';
import { useWorkspace } from '@/app/workspace';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';
import { NotFound } from '@/screens/workspace/NotFound';
import { m } from '@/i18n';

/** Each section is its own chunk; the import wizard and webhooks stay out of the settings entry. */
function section<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}

const ProfileSettings = section(() => import('./account/ProfileSettings'), 'ProfileSettings');
const SessionsSettings = section(() => import('./account/SessionsSettings'), 'SessionsSettings');
const ApiKeysSettings = section(() => import('./account/ApiKeysSettings'), 'ApiKeysSettings');
const GeneralSettings = section(() => import('./workspace/GeneralSettings'), 'GeneralSettings');
const MembersSettings = section(() => import('./workspace/MembersSettings'), 'MembersSettings');
const TeamsSettings = section(() => import('./workspace/TeamsSettings'), 'TeamsSettings');
const TeamSettings = section(() => import('./workspace/TeamSettings'), 'TeamSettings');
const NewTeamSettings = section(() => import('./workspace/NewTeamSettings'), 'NewTeamSettings');
const LabelsSettings = section(() => import('./workspace/LabelsSettings'), 'LabelsSettings');
const GithubSettings = section(() => import('./integrations/GithubSettings'), 'GithubSettings');
const McpSettings = section(() => import('./integrations/McpSettings'), 'McpSettings');
const WebhooksSettings = section(() => import('./integrations/WebhooksSettings'), 'WebhooksSettings');
const ImportSettings = section(() => import('./data/ImportSettings'), 'ImportSettings');
const ExportSettings = section(() => import('./data/ExportSettings'), 'ExportSettings');
const AuditSettings = section(() => import('./data/AuditSettings'), 'AuditSettings');

interface NavEntry {
  path: string;
  label: string;
  icon: IconName;
  ownerOnly?: boolean;
}

interface NavGroup {
  id: string;
  title: string;
  items: NavEntry[];
}

function navGroups(): NavGroup[] {
  const s = m.settings.sections;
  return [
    {
      id: 'account',
      title: s.account,
      items: [
        { path: 'profile', label: s.profile, icon: 'user' },
        { path: 'sessions', label: s.sessions, icon: 'key' },
        { path: 'api-keys', label: s.apiKeys, icon: 'key' },
      ],
    },
    {
      id: 'workspace',
      title: s.workspace,
      items: [
        { path: 'general', label: s.general, icon: 'settings', ownerOnly: true },
        { path: 'members', label: s.members, icon: 'users' },
        { path: 'teams', label: s.teams, icon: 'team' },
        { path: 'labels', label: s.labels, icon: 'label' },
      ],
    },
    {
      id: 'integrations',
      title: s.integrations,
      items: [
        { path: 'github', label: s.github, icon: 'github', ownerOnly: true },
        { path: 'mcp', label: s.mcp, icon: 'sparkle' },
        { path: 'webhooks', label: s.webhooks, icon: 'webhook', ownerOnly: true },
      ],
    },
    {
      id: 'data',
      title: s.data,
      items: [
        { path: 'import', label: s.import, icon: 'import', ownerOnly: true },
        { path: 'export', label: s.export, icon: 'download', ownerOnly: true },
        { path: 'audit', label: s.audit, icon: 'list', ownerOnly: true },
      ],
    },
  ];
}

/** Secondary settings navigation inside the content region (SPEC §4.11.9). */
function SettingsNav() {
  const { viewer } = useWorkspace();
  const { pathname } = useLocation();
  const groups = navGroups()
    .map((g) => ({ ...g, items: g.items.filter((i) => viewer.isOwner || !i.ownerOnly) }))
    .filter((g) => g.items.length > 0);
  return (
    <SideNav
      aria-label={m.settings.title}
      data-testid="settings-nav"
      className="scrollbar-thin hidden w-50 shrink-0 overflow-y-auto border-r border-border bg-surface px-2 py-3 md:block"
    >
      {groups.map((g, i) => (
        <div key={g.id} role="group" aria-labelledby={`settings-nav-${g.id}`} className={i > 0 ? 'mt-4' : undefined}>
          <div id={`settings-nav-${g.id}`} className="flex h-7 items-center px-2 text-sm font-medium text-fg-subtlest">
            {g.title}
          </div>
          {g.items.map((item) => {
              const to = `/settings/${item.path}`;
              return (
                <SideNavItem key={item.path} as={Link} to={to} icon={<Icon name={item.icon} />} selected={pathname === to || pathname.startsWith(`${to}/`)}>
                  {item.label}
                </SideNavItem>
              );
          })}
        </div>
      ))}
    </SideNav>
  );
}

/** Owner-only routes redirect members to their profile instead of showing a dead end. */
function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { viewer } = useWorkspace();
  return viewer.isOwner ? <>{children}</> : <Navigate to="/settings/profile" replace />;
}

export function Settings() {
  const { viewer } = useWorkspace();
  return (
    <div className="flex min-h-0 flex-1" data-testid="settings">
      <SettingsNav />
      <Suspense fallback={<ContentSkeleton rows={8} />}>
        <Routes>
          <Route index element={<Navigate to={viewer.isOwner ? 'general' : 'profile'} replace />} />
          <Route path="profile" element={<ProfileSettings />} />
          <Route path="sessions" element={<SessionsSettings />} />
          <Route path="api-keys" element={<ApiKeysSettings />} />
          <Route path="general" element={<OwnerRoute><GeneralSettings /></OwnerRoute>} />
          <Route path="members" element={<MembersSettings />} />
          <Route path="teams" element={<TeamsSettings />} />
          <Route path="teams/new" element={<NewTeamSettings />} />
          <Route path="teams/:key/*" element={<TeamSettings />} />
          <Route path="labels" element={<LabelsSettings />} />
          <Route path="github" element={<OwnerRoute><GithubSettings /></OwnerRoute>} />
          <Route path="mcp" element={<McpSettings />} />
          <Route path="webhooks/*" element={<OwnerRoute><WebhooksSettings /></OwnerRoute>} />
          <Route path="import/*" element={<OwnerRoute><ImportSettings /></OwnerRoute>} />
          <Route path="export" element={<OwnerRoute><ExportSettings /></OwnerRoute>} />
          <Route path="audit" element={<OwnerRoute><AuditSettings /></OwnerRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  );
}
