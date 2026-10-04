import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, ConfirmDialog, DropdownMenu, EmptyState, Icon, IconButton, MenuItem, MenuSeparator, Modal, Table, TextField, useFlags } from '@velocity/ui';
import type { TableColumn } from '@velocity/ui';
import { useTeamByKey, useWorkspace } from '@/app/workspace';
import type { ViewFieldsFragment } from '@/gql/graphql';
import { ViewHeader } from '@/components/shell/ViewHeader';
import { TeamIcon } from '@/components/common/EntityIcons';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { formatRelative } from '@/lib/format';
import { summarizeFilter, useViewActions } from './viewModel';
import { m } from '@/i18n';

const MAX_CHIPS = 3;

export function ViewIcon({ view }: { view: Pick<ViewFieldsFragment, 'icon'> }) {
  return view.icon ? (
    <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none">
      {view.icon}
    </span>
  ) : (
    <Icon name="view" className="text-fg-subtle" />
  );
}

/** Saved views table (SPEC §3.10): filter summary as readable chips, never raw DSL. */
export function ViewsList() {
  const { key } = useParams();
  const team = useTeamByKey(key);
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { showFlag } = useFlags();
  const actions = useViewActions();
  const [renaming, setRenaming] = useState<ViewFieldsFragment | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<ViewFieldsFragment | null>(null);

  const views = useMemo(() => (team ? ws.views.filter((v) => v.teamId === team.id || v.teamId === null) : ws.views), [ws.views, team]);
  const newHref = team ? `/view/new?team=${team.key}` : '/view/new';

  const copyLink = (v: ViewFieldsFragment) => {
    void navigator.clipboard?.writeText(`${window.location.origin}/view/${v.slug}`).then(() => showFlag({ title: m.view.linkCopied, severity: 'success' }));
  };
  const duplicate = async (v: ViewFieldsFragment) => {
    const created = await actions.create({
      name: m.view.copyOf(v.name),
      icon: v.icon,
      color: v.color,
      teamId: v.teamId,
      filter: v.filter,
      display: { ...v.display, columns: [...v.display.columns] },
    });
    if (created) showFlag({ title: m.view.duplicated(created.name), severity: 'success' });
  };
  const submitRename = async () => {
    if (!renaming) return;
    const name = draft.trim();
    if (!name) return;
    const target = renaming;
    setRenaming(null);
    const res = await actions.update(target.id, { name });
    if (res) showFlag({ title: m.view.renamed, severity: 'success' });
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    if (await actions.remove(target.id)) showFlag({ title: m.view.viewDeleted, severity: 'success' });
  };

  const columns: TableColumn<ViewFieldsFragment>[] = [
    {
      key: 'name',
      header: m.view.list.name,
      sortable: true,
      sortValue: (v) => v.name.toLowerCase(),
      width: '34%',
      render: (v) => (
        <Link to={`/view/${v.slug}`} tabIndex={-1} className="flex min-w-0 items-center gap-2 text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
          <ViewIcon view={v} />
          <span className="truncate font-medium">{v.name}</span>
        </Link>
      ),
    },
    {
      key: 'filters',
      header: m.view.list.filters,
      render: (v) => {
        const chips = summarizeFilter(v.filter, ws);
        if (chips.length === 0) return <span className="text-fg-subtlest">{m.view.list.allIssues}</span>;
        return (
          <span className="flex min-w-0 items-center gap-1">
            {chips.slice(0, MAX_CHIPS).map((c, i) => (
              <span key={i} className="max-w-48 shrink truncate rounded-sm border border-border bg-surface px-1.5 text-sm leading-5 text-fg-subtle">
                {c}
              </span>
            ))}
            {chips.length > MAX_CHIPS ? <span className="shrink-0 text-sm text-fg-subtlest">+{chips.length - MAX_CHIPS}</span> : null}
          </span>
        );
      },
    },
    {
      key: 'owner',
      header: m.view.list.owner,
      width: 88,
      render: (v) => <span className="text-fg-subtle">{v.isMine ? m.view.list.you : m.common.none}</span>,
    },
    {
      key: 'updated',
      header: m.view.list.updated,
      sortable: true,
      sortValue: (v) => v.updatedAt,
      width: 96,
      render: (v) => <span className="text-fg-subtle">{formatRelative(v.updatedAt)}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">{m.view.list.actions}</span>,
      headerLabel: m.view.list.actions,
      width: 88,
      align: 'right',
      render: (v) => (
        <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <FavoriteButton kind="view" targetId={v.id} size="sm" />
          <DropdownMenu
            aria-label={`${m.view.list.actions}: ${v.name}`}
            placement="bottom-end"
            trigger={<IconButton label={m.common.more} size="sm" icon={<Icon name="more" />} />}
          >
            <MenuItem icon={<Icon name="external-link" />} onSelect={() => navigate(`/view/${v.slug}`)}>
              {m.view.list.open}
            </MenuItem>
            <MenuItem
              icon={<Icon name="edit" />}
              onSelect={() => {
                setDraft(v.name);
                setRenaming(v);
              }}
            >
              {m.view.list.rename}
            </MenuItem>
            <MenuItem icon={<Icon name="copy" />} onSelect={() => void duplicate(v)}>
              {m.view.list.duplicate}
            </MenuItem>
            <MenuItem icon={<Icon name="link" />} onSelect={() => copyLink(v)}>
              {m.common.copyLink}
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger icon={<Icon name="trash" />} onSelect={() => setDeleting(v)}>
              {m.view.deleteView}
            </MenuItem>
          </DropdownMenu>
        </span>
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="views-list">
      <ViewHeader
        title={m.view.list.title}
        icon={team ? <TeamIcon team={team} /> : <Icon name="view" className="text-fg-subtle" />}
        count={views.length}
        create={false}
        actions={
          <Button variant="primary" iconBefore={<Icon name="add" />} onClick={() => navigate(newHref)}>
            {m.view.newView}
          </Button>
        }
      />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pt-2">
        <Table
          aria-label={m.view.list.table}
          columns={columns}
          rows={views}
          rowKey={(v) => v.id}
          defaultSort={{ key: 'updated', direction: 'desc' }}
          onRowClick={(v) => navigate(`/view/${v.slug}`)}
          emptyState={
            <EmptyState
              icon="view"
              message={team ? m.view.list.emptyTeam : m.view.list.empty}
              className="py-16"
              action={
                <Button variant="primary" onClick={() => navigate(newHref)}>
                  {m.view.newView}
                </Button>
              }
            />
          }
        />
      </div>
      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={m.view.list.renameTitle}
        size="sm"
        onSubmit={() => void submitRename()}
        footer={
          <>
            <Button onClick={() => setRenaming(null)}>{m.common.cancel}</Button>
            <Button variant="primary" disabled={draft.trim() === ''} onClick={() => void submitRename()}>
              {m.common.save}
            </Button>
          </>
        }
      >
        <TextField label={m.view.viewName} value={draft} onChange={(e) => setDraft(e.target.value)} data-autofocus />
      </Modal>
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        title={m.view.deleteTitle(deleting?.name ?? '')}
        description={m.view.deleteBody}
        confirmLabel={m.common.delete}
        cancelLabel={m.common.cancel}
      />
    </div>
  );
}
