import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@apollo/client';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  Icon,
  IconButton,
  MenuItem,
  MenuSeparator,
  Modal,
  Popover,
  TextField,
  useFlags,
} from '@velocity/ui';
import { useTeamByKey, useWorkspace } from '@/app/workspace';
import { ViewBySlugDocument } from '@/gql/graphql';
import type { ViewFieldsFragment } from '@/gql/graphql';
import { ListScreen } from '@/components/issues/ListScreen';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { ContentSkeleton } from '@/components/shell/ShellSkeleton';
import { canonicalDsl, parseViewState, writeViewState } from '@/lib/viewState';
import type { ViewState } from '@/lib/viewState';
import { NEW_VIEW_STATE, stateToInput, useViewActions, viewToState } from './viewModel';
import { m } from '@/i18n';

const VIEW_PARAMS = ['filter', 'group', 'order', 'layout', 'cols', 'empty', 'sub', 'done'];
const EMOJI = ['📋', '🔥', '🐛', '🚀', '⭐', '🎯', '🧭', '📌', '🛠️', '💡', '📈', '🔒', '🧪', '📦', '👀', '✅'];

/** `/view/new` and `/view/:slug`: a saved view is an issue list whose defaults come from the view (SPEC §3.10, §4.11.6). */
export function ViewPage() {
  const { slug } = useParams();
  const ws = useWorkspace();
  const cached = slug ? ws.views.find((v) => v.slug === slug || v.id === slug) : undefined;
  const query = useQuery(ViewBySlugDocument, { variables: { id: slug ?? '' }, skip: !slug || Boolean(cached) });
  if (!slug) return <ViewEditor key="new" view={null} />;
  const view = cached ?? query.data?.view ?? null;
  if (!view) {
    if (query.loading || !query.data) {
      if (query.error) return <ViewMissing />;
      return <ContentSkeleton rows={10} />;
    }
    return <ViewMissing />;
  }
  return <ViewEditor key={view.id} view={view} />;
}

function ViewMissing() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EmptyState
        icon="view"
        message={m.view.notFound}
        fill
        action={
          <Link to="/views" className="text-link hover:underline">
            {m.view.backToViews}
          </Link>
        }
      />
    </div>
  );
}

function IconPicker({ value, onChange }: { value: string | null; onChange: (icon: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        type="button"
        ref={setAnchor}
        aria-label={m.view.iconLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-base leading-none transition-colors duration-100 hover:bg-hover"
      >
        {value ? <span aria-hidden="true">{value}</span> : <Icon name="view" className="text-fg-subtle" />}
      </button>
      <Popover
        anchorEl={anchor}
        open={open}
        onDismiss={() => setOpen(false)}
        placement="bottom-start"
        role="dialog"
        aria-label={m.view.iconLabel}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
            anchor?.focus();
          }
        }}
      >
        <div className="grid grid-cols-8 gap-1 p-2">
          {EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={e}
              onClick={() => {
                onChange(e);
                setOpen(false);
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-base hover:bg-hover"
            >
              {e}
            </button>
          ))}
        </div>
        {value ? (
          <div className="border-t border-border p-1">
            <Button
              size="sm"
              variant="subtle"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              {m.common.remove}
            </Button>
          </div>
        ) : null}
      </Popover>
    </>
  );
}

function ViewEditor({ view }: { view: ViewFieldsFragment | null }) {
  const navigate = useNavigate();
  const { showFlag } = useFlags();
  const actions = useViewActions();
  const [params, setParams] = useSearchParams();
  const teamParam = useTeamByKey(params.get('team') ?? undefined);
  const teamId = view ? view.teamId : (teamParam?.id ?? null);

  const defaults = useMemo<ViewState>(() => (view ? viewToState(view) : NEW_VIEW_STATE), [view]);
  const state = useMemo(() => parseViewState(params, defaults), [params, defaults]);

  const [name, setName] = useState(view?.name ?? '');
  const [icon, setIcon] = useState<string | null>(view?.icon ?? null);
  const [saving, setSaving] = useState(false);
  const [asNewOpen, setAsNewOpen] = useState(false);
  const [asNewName, setAsNewName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Follow server-side changes (rename from the list, another tab) without an effect.
  const [seen, setSeen] = useState({ name: view?.name, icon: view?.icon });
  if (view && (seen.name !== view.name || seen.icon !== view.icon)) {
    setSeen({ name: view.name, icon: view.icon });
    setName(view.name);
    setIcon(view.icon ?? null);
  }

  const sameFilter = canonicalDsl(state.filter) === canonicalDsl(defaults.filter);
  const stateDirty = writeViewState({ ...state, filter: sameFilter ? defaults.filter : state.filter }, defaults).toString() !== '';
  const metaDirty = view ? name.trim() !== view.name || (icon ?? null) !== (view.icon ?? null) : false;
  const dirty = stateDirty || metaDirty;

  const clearViewParams = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of VIEW_PARAMS) next.delete(k);
        return next;
      },
      { replace: true },
    );

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      nameRef.current?.focus();
      showFlag({ title: m.view.nameRequired, severity: 'warning' });
      return;
    }
    setSaving(true);
    try {
      if (!view) {
        const created = await actions.create({ name: trimmed, icon, teamId, ...stateToInput(state) });
        if (created) {
          showFlag({ title: m.view.viewSaved(created.name), severity: 'success' });
          navigate(`/view/${created.slug}`, { replace: true });
        }
      } else {
        const updated = await actions.update(view.id, { name: trimmed, icon, ...stateToInput(state) });
        if (updated) {
          clearViewParams();
          showFlag({ title: m.view.viewSaved(updated.name), severity: 'success' });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const saveAsNew = async () => {
    const trimmed = asNewName.trim();
    if (!trimmed) return;
    setAsNewOpen(false);
    const created = await actions.create({ name: trimmed, icon, teamId, ...stateToInput(state) });
    if (created) {
      showFlag({ title: m.view.created(created.name), severity: 'success' });
      navigate(`/view/${created.slug}`);
    }
  };

  const copyLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('issue');
    void navigator.clipboard?.writeText(url.toString()).then(() => showFlag({ title: m.view.linkCopied, severity: 'success' }));
  };

  const confirmDelete = async () => {
    if (!view) return;
    setDeleting(false);
    if (await actions.remove(view.id)) {
      showFlag({ title: m.view.viewDeleted, severity: 'success' });
      navigate('/views', { replace: true });
    }
  };

  const commitName = () => {
    if (!view) return;
    const trimmed = name.trim();
    if (!trimmed) setName(view.name);
  };

  const title = (
    <span className="flex items-center gap-1">
      <IconPicker value={icon} onChange={setIcon} />
      <input
        ref={nameRef}
        type="text"
        value={name}
        aria-label={m.view.nameLabel}
        placeholder={m.view.namePlaceholder}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            setName(view?.name ?? '');
            e.currentTarget.blur();
          }
        }}
        style={{ width: `${Math.min(32, Math.max(12, (name || m.view.namePlaceholder).length + 2))}ch` }}
        className="h-7 min-w-0 max-w-full rounded-sm border border-transparent bg-transparent px-1 text-md font-semibold text-fg placeholder:font-normal placeholder:text-fg-subtlest hover:border-border focus:border-primary"
      />
    </span>
  );

  const headerActions = (
    <>
      {dirty ? (
        <span className="hidden whitespace-nowrap pr-1 text-sm text-fg-subtle lg:inline" data-testid="unsaved-hint">
          {m.view.unsaved}
        </span>
      ) : null}
      {view ? <FavoriteButton kind="view" targetId={view.id} /> : null}
      {view ? <IconButton label={m.view.shareLink} icon={<Icon name="link" />} onClick={copyLink} /> : null}
      <DropdownMenu aria-label={m.common.more} placement="bottom-end" trigger={<IconButton label={m.common.more} icon={<Icon name="more" />} />}>
        <MenuItem
          icon={<Icon name="copy" />}
          onSelect={() => {
            setAsNewName(name.trim() ? m.view.copyOf(name.trim()) : '');
            setAsNewOpen(true);
          }}
        >
          {m.view.saveAsNew}
        </MenuItem>
        {view ? (
          <>
            <MenuSeparator />
            <MenuItem danger icon={<Icon name="trash" />} onSelect={() => setDeleting(true)}>
              {m.view.deleteView}
            </MenuItem>
          </>
        ) : null}
      </DropdownMenu>
      <Button variant="primary" loading={saving} disabled={view ? !dirty : false} onClick={() => void save()} data-testid="save-view">
        {m.view.save}
      </Button>
    </>
  );

  return (
    <>
      <ListScreen
        listId={`view-${view?.id ?? 'new'}`}
        title={title}
        scope={teamId ? { teamId } : {}}
        defaults={defaults}
        context={teamId ? { teamId } : {}}
        actions={headerActions}
        noCreate
        hiddenFilterFields={teamId ? ['team'] : []}
        empty={<EmptyState icon="filter" message={m.list.emptyFiltered} />}
      />
      <Modal
        open={asNewOpen}
        onClose={() => setAsNewOpen(false)}
        title={m.view.saveAsNew}
        size="sm"
        onSubmit={() => void saveAsNew()}
        footer={
          <>
            <Button onClick={() => setAsNewOpen(false)}>{m.common.cancel}</Button>
            <Button variant="primary" disabled={asNewName.trim() === ''} onClick={() => void saveAsNew()}>
              {m.common.create}
            </Button>
          </>
        }
      >
        <TextField label={m.view.viewName} value={asNewName} onChange={(e) => setAsNewName(e.target.value)} data-autofocus />
      </Modal>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => void confirmDelete()}
        title={m.view.deleteTitle(view?.name ?? '')}
        description={m.view.deleteBody}
        confirmLabel={m.common.delete}
        cancelLabel={m.common.cancel}
      />
    </>
  );
}
