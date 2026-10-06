import { Suspense, lazy } from 'react';
import type { ComponentType } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Icon, SideNav, SideNavItem } from '@velocity/ui';
import { useWorkspace } from '@/app/workspace';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';
import { NotFound } from '@/screens/workspace/NotFound';
import { FeatureOffNotice } from '@/components/common/FeatureOffNotice';
import { useFeatures } from '@/lib/features';
import { m } from '@/i18n';
import { isSettingsSectionActive, settingsNavGroups } from './nav';

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
const CodingToolsSettings = section(() => import('./account/CodingToolsSettings'), 'CodingToolsSettings');
const FeaturesSettings = section(() => import('./workspace/FeaturesSettings'), 'FeaturesSettings');

/** Secondary settings navigation inside the content region (SPEC §4.11.9). */
function SettingsNav() {
  const { viewer } = useWorkspace();
  const { pathname } = useLocation();
  const groups = settingsNavGroups(viewer.isOwner, useFeatures());
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
          {g.items.map((item) => (
            <SideNavItem
              key={item.path}
              as={Link}
              to={`/settings/${item.path}`}
              icon={<Icon name={item.icon} />}
              selected={isSettingsSectionActive(pathname, item.path)}
            >
              {item.label}
            </SideNavItem>
          ))}
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

/** Solo mode (U4): with Members off, member management is replaced by a notice. */
function MembersRoute({ children }: { children: React.ReactNode }) {
  const features = useFeatures();
  return features.members ? <>{children}</> : <FeatureOffNotice feature="members" />;
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
          <Route path="coding-tools" element={<CodingToolsSettings />} />
          <Route path="features" element={<OwnerRoute><FeaturesSettings /></OwnerRoute>} />
          <Route path="general" element={<OwnerRoute><GeneralSettings /></OwnerRoute>} />
          <Route path="members" element={<MembersRoute><MembersSettings /></MembersRoute>} />
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
