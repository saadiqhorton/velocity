import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { m } from '@/i18n';
import { SettingsSectionMenu, isSettingsSectionActive, settingsNavGroups } from './nav';

const viewer = { isOwner: true };
vi.mock('@/app/workspace', () => ({ useWorkspace: () => ({ viewer }) }));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderMenu(path: string, isOwner: boolean) {
  viewer.isOwner = isOwner;
  render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsSectionMenu />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  const trigger = screen.getByRole('button', { name: m.settings.sectionMenuTrigger });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return trigger;
}

describe('settings section navigation', () => {
  it('hides owner-only sections from members', () => {
    const owner = settingsNavGroups(true).flatMap((g) => g.items.map((i) => i.path));
    const member = settingsNavGroups(false).flatMap((g) => g.items.map((i) => i.path));
    expect(owner).toEqual(['profile', 'sessions', 'api-keys', 'coding-tools', 'general', 'features', 'members', 'teams', 'labels', 'github', 'mcp', 'webhooks', 'import', 'export', 'audit']);
    expect(member).toEqual(['profile', 'sessions', 'api-keys', 'coding-tools', 'members', 'teams', 'labels', 'mcp']);
    // A group with nothing left for a member disappears entirely.
    expect(settingsNavGroups(false).map((g) => g.id)).toEqual(['account', 'workspace', 'integrations']);
  });

  it('hides member management in Solo mode (U4)', () => {
    const solo = { cycles: false, estimates: false, insights: false, members: false, solo: true };
    const paths = settingsNavGroups(true, solo).flatMap((g) => g.items.map((i) => i.path));
    expect(paths).not.toContain('members');
    expect(paths).toContain('features');
    expect(paths).toContain('profile');
  });

  it('treats nested pages as part of their section', () => {
    expect(isSettingsSectionActive('/settings/teams/ENG/workflow', 'teams')).toBe(true);
    expect(isSettingsSectionActive('/settings/teams', 'teams')).toBe(true);
    expect(isSettingsSectionActive('/settings/teamsx', 'teams')).toBe(false);
  });

  it('phone menu: keyboard opens it, marks the current section, and navigates', () => {
    renderMenu('/settings/teams/ENG/workflow', true);
    const menu = screen.getByRole('menu', { name: m.settings.sectionMenu });
    expect(menu).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: m.settings.sections.profile }));
    expect(screen.getByRole('menuitem', { name: m.settings.sections.teams }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('group', { name: m.settings.sections.data })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: m.settings.sections.audit }));
    expect(screen.getByTestId('where').textContent).toBe('/settings/audit');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('phone menu: members see no owner-only sections', () => {
    renderMenu('/settings/profile', false);
    expect(screen.queryByRole('menuitem', { name: m.settings.sections.general })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: m.settings.sections.webhooks })).toBeNull();
    expect(screen.queryByRole('group', { name: m.settings.sections.data })).toBeNull();
    expect(screen.getByRole('menuitem', { name: m.settings.sections.mcp })).toBeTruthy();
  });
});
