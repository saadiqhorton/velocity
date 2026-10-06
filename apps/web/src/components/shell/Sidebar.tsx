import { useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useApolloClient, useQuery } from '@apollo/client';
import clsx from 'clsx';
import { Avatar, Badge, DropdownMenu, Icon, IconButton, Kbd, MenuGroup, MenuItem, MenuSeparator, SideNav, SideNavGroup, SideNavItem } from '@velocity/ui';
import { LogoutDocument, ReorderFavoriteDocument, SidebarCountsDocument } from '@/gql/graphql';
import type { FavoriteFieldsFragment, TeamFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useOptimisticMutation } from '@/lib/mutation';
import { useSidebar } from '@/stores/sidebar';
import { useUi } from '@/stores/ui';
import { useTheme } from '@/stores/theme';
import { useSetTheme } from './theme';
import { ProjectIcon, TeamIcon } from '@/components/common/EntityIcons';
import { teamUsesCycles, useFeatures } from '@/lib/features';
import { m } from '@/i18n';

const MAX_PROJECTS = 8;

function useIsActive() {
  const { pathname } = useLocation();
  return (path: string, exact = false) => (exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`));
}

function SidebarSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const onSearch = pathname === '/search';
  // Typing navigates to /search?q=…, so the URL is the source of truth for the value.
  const value = onSearch ? (params.get('q') ?? '') : '';
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative px-2">
      <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fg-subtlest" />
      <input
        ref={inputRef}
        id="sidebar-search"
        type="search"
        aria-label={m.nav.search}
        placeholder={m.nav.searchShortcut}
        value={value}
        autoComplete="off"
        onChange={(e) => {
          navigate(`/search?q=${encodeURIComponent(e.target.value)}`, { replace: onSearch });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            inputRef.current?.blur();
            document.querySelector<HTMLElement>('[data-region="list"] [tabindex="0"]')?.focus();
          }
        }}
        className="h-7 w-full rounded-sm border border-border bg-surface pl-7 pr-8 text-base text-fg placeholder:text-fg-subtlest hover:border-border-input focus:border-primary [&::-webkit-search-cancel-button]:hidden"
      />
      <Kbd className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2">/</Kbd>
    </div>
  );
}

function TeamGroup({ team }: { team: TeamFieldsFragment }) {
  const isActive = useIsActive();
  const collapsed = useSidebar((s) => s.collapsed[`team:${team.id}`] ?? false);
  const setCollapsed = useSidebar((s) => s.setCollapsed);
  const base = `/team/${team.key}`;
  const features = useFeatures();
  return (
    <SideNavGroup
      variant="item"
      title={team.name}
      label={team.name}
      icon={<TeamIcon team={team} />}
      collapsed={collapsed}
      onCollapsedChange={(c) => setCollapsed(`team:${team.id}`, c)}
    >
      <SideNavItem as={Link} to={`${base}/active`} level={1} icon={<Icon name="active" />} selected={isActive(`${base}/active`)}>
        {features.solo ? m.nav.issues : m.nav.active}
      </SideNavItem>
      <SideNavItem as={Link} to={`${base}/backlog`} level={1} icon={<Icon name="backlog" />} selected={isActive(`${base}/backlog`)}>
        {m.nav.backlog}
      </SideNavItem>
      {teamUsesCycles(features, team) ? (
        <SideNavItem as={Link} to={`${base}/cycles`} level={1} icon={<Icon name="cycle" />} selected={isActive(`${base}/cycles`)}>
          {m.nav.cycles}
        </SideNavItem>
      ) : null}
      {/* Solo mode (U4): projects live in the workspace Projects section only. */}
      {!features.solo ? (
        <SideNavItem as={Link} to={`${base}/projects`} level={1} icon={<Icon name="project" />} selected={isActive(`${base}/projects`)}>
          {m.nav.projects}
        </SideNavItem>
      ) : null}
      <SideNavItem as={Link} to={`${base}/views`} level={1} icon={<Icon name="view" />} selected={isActive(`${base}/views`)}>
        {m.nav.views}
      </SideNavItem>
    </SideNavGroup>
  );
}

function favoriteTarget(f: FavoriteFieldsFragment, teamKey: (id: string) => string): { to: string; label: string; icon: ReactNode } | null {
  switch (f.kind) {
    case 'view':
      return f.view ? { to: `/view/${f.view.slug}`, label: f.view.name, icon: <Icon name="view" /> } : null;
    case 'project':
      return f.project ? { to: `/project/${f.project.id}`, label: f.project.name, icon: <ProjectIcon project={f.project} /> } : null;
    case 'team':
      return f.team ? { to: `/team/${f.team.key}/active`, label: f.team.name, icon: <Icon name="team" /> } : null;
    case 'issue':
      return f.issue ? { to: `/issue/${f.issue.identifier}`, label: `${f.issue.identifier} ${f.issue.title}`, icon: <Icon name="list" /> } : null;
    case 'cycle':
      return f.cycle ? { to: `/team/${teamKey(f.cycle.teamId)}/cycles/${f.cycle.id}`, label: f.cycle.name, icon: <Icon name="cycle" /> } : null;
    default:
      return null;
  }
}

function Favorites() {
  const { favorites, teamsById } = useWorkspace();
  const teamKey = (id: string) => teamsById.get(id)?.key ?? id;
  const isActive = useIsActive();
  const collapsed = useSidebar((s) => s.collapsed.favorites ?? false);
  const setCollapsed = useSidebar((s) => s.setCollapsed);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [reorder] = useOptimisticMutation(ReorderFavoriteDocument, {
    optimistic: (vars) => {
      const before = favorites.find((f) => f.id === vars.beforeId);
      const after = favorites.find((f) => f.id === vars.afterId);
      const sortOrder =
        before && after ? (before.sortOrder + after.sortOrder) / 2 : before ? before.sortOrder - 1 : after ? after.sortOrder + 1 : 0;
      return { __typename: 'Mutation' as const, reorderFavorite: { __typename: 'Favorite' as const, id: vars.id, sortOrder } };
    },
    rollback: () => m.flags.rollback.favorite,
  });

  if (favorites.length === 0) return null;

  const onDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    setOverId(null);
    if (!dragId || dragId === targetId) return;
    const ids = favorites.map((f) => f.id).filter((id) => id !== dragId);
    const idx = ids.indexOf(targetId);
    const from = favorites.findIndex((f) => f.id === dragId);
    const to = favorites.findIndex((f) => f.id === targetId);
    // Dropping onto an item places the dragged one where that item was.
    const insertAt = from < to ? idx + 1 : idx;
    const afterId = ids[insertAt - 1] ?? null;
    const beforeId = ids[insertAt] ?? null;
    void reorder({ id: dragId, afterId, beforeId });
    setDragId(null);
  };

  return (
    <SideNavGroup title={m.nav.favorites} collapsed={collapsed} onCollapsedChange={(c) => setCollapsed('favorites', c)}>
      {favorites.map((f) => {
        const t = favoriteTarget(f, teamKey);
        if (!t) return null;
        return (
          <div
            key={f.id}
            draggable
            onDragStart={(e) => {
              setDragId(f.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverId(f.id);
            }}
            onDrop={(e) => onDrop(e, f.id)}
            className={clsx('rounded-sm', overId === f.id && dragId !== f.id && 'outline outline-1 outline-primary')}
          >
            <SideNavItem as={Link} to={t.to} icon={t.icon} selected={isActive(t.to, true)}>
              {t.label}
            </SideNavItem>
          </div>
        );
      })}
    </SideNavGroup>
  );
}

function NewMenu() {
  const openCreate = useUi((s) => s.openCreate);
  const navigate = useNavigate();
  return (
    <DropdownMenu
      aria-label={m.nav.newMenu}
      placement="top-start"
      trigger={
        <button
          type="button"
          className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-sm px-2 text-base text-fg-subtle transition-colors duration-100 hover:bg-hover hover:text-fg"
        >
          <Icon name="add" />
          <span className="truncate">{m.nav.newMenu}</span>
        </button>
      }
    >
      <MenuItem icon={<Icon name="list" />} shortcut={<Kbd>C</Kbd>} onSelect={() => openCreate()}>
        {m.nav.newIssue}
      </MenuItem>
      <MenuItem icon={<Icon name="team" />} onSelect={() => navigate('/settings/teams/new')}>
        {m.nav.newTeam}
      </MenuItem>
      <MenuItem icon={<Icon name="project" />} onSelect={() => navigate('/projects?new=1')}>
        {m.nav.newProject}
      </MenuItem>
      <MenuItem icon={<Icon name="view" />} onSelect={() => navigate('/view/new')}>
        {m.nav.newView}
      </MenuItem>
    </DropdownMenu>
  );
}

function AccountMenu() {
  const { viewer, workspace } = useWorkspace();
  const client = useApolloClient();
  const navigate = useNavigate();
  const setTheme = useSetTheme();
  const resolved = useTheme((s) => s.resolved);
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen);
  const [logout] = useOptimisticMutation(LogoutDocument, {
    optimistic: { serverConfirmed: 'Session cookies are cleared by the server response.' },
    rollback: () => m.flags.rollback.generic,
  });
  return (
    <DropdownMenu
      aria-label={m.nav.userMenu}
      placement="top-start"
      trigger={
        <button
          type="button"
          data-testid="account-menu"
          className="flex h-10 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left transition-colors duration-100 hover:bg-hover"
        >
          <Avatar name={viewer.name} src={viewer.avatarUrl} size={24} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-medium text-fg">{viewer.name}</span>
            <span className="block truncate text-sm text-fg-subtlest">{workspace?.name}</span>
          </span>
        </button>
      }
    >
      <MenuGroup>
        <MenuItem icon={<Icon name="user" />} onSelect={() => navigate('/settings/profile')}>
          {m.nav.profile}
        </MenuItem>
        <MenuItem
          icon={<Icon name={resolved === 'dark' ? 'sun' : 'moon'} />}
          onSelect={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
        >
          {m.nav.toggleTheme}
        </MenuItem>
        <MenuItem icon={<Icon name="keyboard" />} shortcut={<Kbd>?</Kbd>} onSelect={() => setShortcutsOpen(true)}>
          {m.nav.keyboardShortcuts}
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuItem
        icon={<Icon name="logout" />}
        onSelect={() => {
          void logout({}).then(async () => {
            await client.clearStore();
            navigate('/login', { replace: true });
          });
        }}
      >
        {m.nav.logout}
      </MenuItem>
    </DropdownMenu>
  );
}

export function Sidebar({ className }: { className?: string }) {
  const { workspace, teams, projects } = useWorkspace();
  const isActive = useIsActive();
  const counts = useQuery(SidebarCountsDocument, { fetchPolicy: 'cache-and-network' });
  const unread = counts.data?.unreadNotificationCount ?? 0;
  const teamsCollapsed = useSidebar((s) => s.collapsed.teams ?? false);
  const projectsCollapsed = useSidebar((s) => s.collapsed.projects ?? false);
  const setCollapsed = useSidebar((s) => s.setCollapsed);
  const navigate = useNavigate();
  const shownProjects = projects.filter((p) => p.status !== 'completed' && p.status !== 'canceled').slice(0, MAX_PROJECTS);
  const overflow = projects.length - shownProjects.length;

  return (
    <aside
      data-region="sidebar"
      aria-label={m.nav.sidebar}
      data-testid="sidebar"
      className={clsx('flex h-full shrink-0 flex-col border-r border-border bg-sunken', className)}
    >
      <div className="flex h-12 shrink-0 items-center px-4">
        <span className="truncate text-base font-semibold text-fg" data-testid="workspace-name">
          {workspace?.name}
        </span>
      </div>
      <SidebarSearch />
      <SideNav aria-label={m.nav.primaryNav} className="scrollbar-thin mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <SideNavItem
          as={Link}
          to="/inbox"
          icon={<Icon name="inbox" />}
          selected={isActive('/inbox')}
          trailing={unread > 0 ? <Badge value={unread} appearance="primary" /> : null}
        >
          <span>{m.nav.inbox}</span>
          {unread > 0 ? <span className="sr-only">, {m.nav.unreadCount(unread)}</span> : null}
        </SideNavItem>
        <SideNavItem as={Link} to="/my-issues" icon={<Icon name="my-issues" />} selected={isActive('/my-issues')}>
          {m.nav.myIssues}
        </SideNavItem>

        <div className="h-4" aria-hidden="true" />
        <SideNavGroup title={m.nav.teams} collapsed={teamsCollapsed} onCollapsedChange={(c) => setCollapsed('teams', c)}>
          {teams.map((t) => (
            <TeamGroup key={t.id} team={t} />
          ))}
        </SideNavGroup>

        <div className="h-4" aria-hidden="true" />
        <SideNavGroup
          title={m.nav.projects}
          collapsed={projectsCollapsed}
          onCollapsedChange={(c) => setCollapsed('projects', c)}
        >
          {shownProjects.map((p) => (
            <SideNavItem
              key={p.id}
              as={Link}
              to={`/project/${p.id}`}
              icon={<ProjectIcon project={p} />}
              selected={isActive(`/project/${p.id}`)}
            >
              {p.name}
            </SideNavItem>
          ))}
          {overflow > 0 || projects.length === 0 ? (
            <SideNavItem
              as={Link}
              to="/projects"
              icon={<Icon name="more" />}
              selected={isActive('/projects', true)}
              onClick={() => navigate('/projects')}
            >
              {overflow > 0 ? m.nav.moreProjects(overflow) : m.nav.projects}
            </SideNavItem>
          ) : null}
        </SideNavGroup>

        <div className="h-4" aria-hidden="true" />
        <Favorites />
      </SideNav>

      <div className="shrink-0 border-t border-border px-2 py-2">
        <div className="flex items-center gap-1">
          <NewMenu />
          <IconButton
            label={m.nav.settings}
            size="sm"
            icon={<Icon name="settings" />}
            onClick={() => navigate('/settings')}
            className={clsx(isActive('/settings') && 'bg-raised text-fg-selected')}
          />
        </div>
        <AccountMenu />
      </div>
    </aside>
  );
}
