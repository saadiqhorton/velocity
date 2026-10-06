import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, DropdownMenu, Icon, MenuGroup, MenuItem } from '@velocity/ui';
import type { IconName } from '@velocity/ui';
import { useWorkspace } from '@/app/workspace';
import { ALL_FEATURES, useFeatures } from '@/lib/features';
import type { Features } from '@/lib/features';
import { m } from '@/i18n';

export interface SettingsNavEntry {
  path: string;
  label: string;
  icon: IconName;
  ownerOnly?: boolean;
}

export interface SettingsNavGroup {
  id: string;
  title: string;
  items: SettingsNavEntry[];
}

/** Settings sections by group (SPEC §4.11.9). Members never see owner-only sections. */
export function settingsNavGroups(isOwner: boolean, features: Features = ALL_FEATURES): SettingsNavGroup[] {
  const s = m.settings.sections;
  const groups: SettingsNavGroup[] = [
    {
      id: 'account',
      title: s.account,
      items: [
        { path: 'profile', label: s.profile, icon: 'user' },
        { path: 'sessions', label: s.sessions, icon: 'key' },
        { path: 'api-keys', label: s.apiKeys, icon: 'key' },
        { path: 'coding-tools', label: s.codingTools, icon: 'code' },
      ],
    },
    {
      id: 'workspace',
      title: s.workspace,
      items: [
        { path: 'general', label: s.general, icon: 'settings', ownerOnly: true },
        { path: 'features', label: s.features, icon: 'toggle', ownerOnly: true },
        // Solo mode (U4): member management hides with the Members feature.
        ...(features.members ? [{ path: 'members', label: s.members, icon: 'users' as const }] : []),
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
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => isOwner || !i.ownerOnly) }))
    .filter((g) => g.items.length > 0);
}

/** A section is current on its own page and on any page nested under it (e.g. a team's workflow). */
export function isSettingsSectionActive(pathname: string, path: string): boolean {
  const to = `/settings/${path}`;
  return pathname === to || pathname.startsWith(`${to}/`);
}

const FOCUS_STATE = 'settingsSectionMenu';

/**
 * Phone-width section switcher for the settings header. Below 768px the section list beside the
 * content is hidden, so this menu button is the only way between sections. Hidden from `md` up.
 */
export function SettingsSectionMenu() {
  const { viewer } = useWorkspace();
  const features = useFeatures();
  const { pathname, state } = useLocation();
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Each section renders its own header, so the menu remounts after a pick: keep focus on it.
  const refocus = (state as { [FOCUS_STATE]?: boolean } | null)?.[FOCUS_STATE] === true;
  useEffect(() => {
    if (refocus) triggerRef.current?.focus();
  }, [refocus, pathname]);
  return (
    <div className="ml-auto shrink-0 md:hidden" data-testid="settings-section-menu">
      <DropdownMenu
        aria-label={m.settings.sectionMenu}
        placement="bottom-end"
        trigger={
          <Button ref={triggerRef} size="sm" variant="subtle" iconAfter={<Icon name="chevron-down" className="h-3 w-3" />}>
            {m.settings.sectionMenuTrigger}
          </Button>
        }
      >
        {settingsNavGroups(viewer.isOwner, features).map((g) => (
          <MenuGroup key={g.id} heading={g.title}>
            {g.items.map((item) => (
              <MenuItem
                key={item.path}
                icon={<Icon name={item.icon} />}
                current={isSettingsSectionActive(pathname, item.path)}
                onSelect={() => navigate(`/settings/${item.path}`, { state: { [FOCUS_STATE]: true } })}
              >
                {item.label}
              </MenuItem>
            ))}
          </MenuGroup>
        ))}
      </DropdownMenu>
    </div>
  );
}
