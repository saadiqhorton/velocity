import { useRef, useState } from 'react';
import clsx from 'clsx';
import { Button, DropdownMenu, Icon, IconButton, MenuItem, Modal, Popover, Select, StatusIcon, TextField } from '@velocity/ui';
import {
  CreateStatusDocument,
  DeleteStatusDocument,
  ReorderStatusDocument,
  UpdateStatusDocument,
} from '@/gql/graphql';
import type { PaletteColor, StatusCategory, StatusFieldsFragment, TeamFieldsFragment } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { SettingsSection } from '../common';
import { PaletteSwatches, orderBetween } from './shared';
import { m } from '@/i18n';

const CATEGORIES: readonly StatusCategory[] = ['backlog', 'todo', 'in_progress', 'done', 'canceled'];
const MAX_STATUSES = 20;
const DEFAULT_COLOR: Record<StatusCategory, PaletteColor> = {
  backlog: 'grey',
  todo: 'blue',
  in_progress: 'yellow',
  done: 'green',
  canceled: 'grey',
};

type DropPos = 'before' | 'after';

export function TeamWorkflowTab({ team }: { team: TeamFieldsFragment }) {
  const t = m.settingsWorkspace.workflow;
  const statuses = [...team.statuses].sort((a, b) => a.order - b.order);
  const byCategory = (c: StatusCategory) => statuses.filter((s) => s.category === c);
  const atLimit = statuses.length >= MAX_STATUSES;
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; pos: DropPos } | null>(null);
  const [deleting, setDeleting] = useState<StatusFieldsFragment | null>(null);

  const [update] = useOptimisticMutation(UpdateStatusDocument, {
    optimistic: (vars) => {
      const cur = team.statuses.find((s) => s.id === vars.id);
      if (!cur) throw new Error('status not cached');
      return {
        __typename: 'Mutation' as const,
        updateStatus: {
          ...cur,
          name: vars.input.name ?? cur.name,
          color: vars.input.color ?? cur.color,
          description: vars.input.description !== undefined ? vars.input.description : cur.description,
        },
      };
    },
    rollback: () => t.flag.update,
  });
  const [reorder] = useOptimisticMutation(ReorderStatusDocument, {
    optimistic: (vars) => {
      const prev = team.statuses.find((s) => s.id === vars.beforeId);
      const next = team.statuses.find((s) => s.id === vars.afterId);
      return {
        __typename: 'Mutation' as const,
        reorderStatus: { __typename: 'WorkflowStatus' as const, id: vars.id, order: orderBetween(prev?.order ?? null, next?.order ?? null) },
      };
    },
    rollback: () => t.flag.reorder,
    refetchQueries: ['Bootstrap'],
  });

  /** Place `id` at `index` of the category list (without itself). */
  const place = (id: string, category: StatusCategory, index: number) => {
    const list = byCategory(category).filter((s) => s.id !== id);
    void reorder({ id, beforeId: list[index - 1]?.id ?? null, afterId: list[index]?.id ?? null });
  };
  const move = (s: StatusFieldsFragment, delta: -1 | 1) => {
    const list = byCategory(s.category);
    const idx = list.findIndex((x) => x.id === s.id);
    const target = idx + delta;
    if (target < 0 || target >= list.length) return;
    place(s.id, s.category, target);
  };
  const drop = (target: StatusFieldsFragment) => {
    const drag = statuses.find((s) => s.id === dragId);
    const pos = over?.pos ?? 'after';
    setDragId(null);
    setOver(null);
    if (!drag || drag.category !== target.category || drag.id === target.id) return;
    const list = byCategory(target.category).filter((s) => s.id !== drag.id);
    const idx = list.findIndex((s) => s.id === target.id);
    place(drag.id, target.category, idx + (pos === 'after' ? 1 : 0));
  };

  const canDelete = (s: StatusFieldsFragment) => {
    const inCat = byCategory(s.category).length;
    if (s.category === 'backlog' || s.category === 'todo') return byCategory('backlog').length + byCategory('todo').length > 1;
    return inCat > 1;
  };

  return (
    <SettingsSection
      title={t.section}
      description={t.description}
      actions={<span className={clsx('text-sm', atLimit ? 'text-warning-fg' : 'text-fg-subtle')}>{t.count(statuses.length)}</span>}
      testId="workflow-editor"
    >
      <div className="flex flex-col">
        {CATEGORIES.map((category) => {
          const list = byCategory(category);
          return (
            <div key={category} role="group" aria-label={t.categories[category]} className="border-t border-border first:border-t-0" data-testid={`workflow-${category}`}>
              <div className="flex h-10 items-center gap-2 bg-sunken px-4 first:rounded-t-md">
                <StatusIcon category={category} size={16} label="" />
                <h3 className="flex-1 text-sm font-semibold uppercase text-fg-subtle">{t.categories[category]}</h3>
                <AddStatus team={team} category={category} disabled={atLimit} />
              </div>
              {list.length === 0 ? (
                <p className="px-4 py-3 text-base text-fg-subtle">{t.empty}</p>
              ) : (
                <ul>
                  {list.map((s, i) => (
                    <StatusRow
                      key={s.id}
                      status={s}
                      first={i === 0}
                      last={i === list.length - 1}
                      deletable={canDelete(s)}
                      dragging={dragId === s.id}
                      dropPos={over?.id === s.id && dragId !== null && dragId !== s.id ? over.pos : null}
                      onDragStart={() => setDragId(s.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOver(null);
                      }}
                      onDragOver={(pos) => {
                        const drag = statuses.find((x) => x.id === dragId);
                        if (!drag || drag.category !== s.category) return false;
                        setOver((o) => (o?.id === s.id && o.pos === pos ? o : { id: s.id, pos }));
                        return true;
                      }}
                      onDrop={() => drop(s)}
                      onPatch={(input) => void update({ id: s.id, input })}
                      onMove={(d) => move(s, d)}
                      onDelete={() => setDeleting(s)}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {atLimit ? <p className="border-t border-border px-4 py-3 text-sm text-warning-fg">{t.limit}</p> : null}
      {deleting ? <DeleteStatusModal status={deleting} siblings={statuses.filter((x) => x.id !== deleting.id)} onClose={() => setDeleting(null)} /> : null}
    </SettingsSection>
  );
}

interface StatusRowProps {
  status: StatusFieldsFragment;
  first: boolean;
  last: boolean;
  deletable: boolean;
  dragging: boolean;
  dropPos: DropPos | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (pos: DropPos) => boolean;
  onDrop: () => void;
  onPatch: (input: { name?: string; color?: PaletteColor; description?: string | null }) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}

function StatusRow({ status, first, last, deletable, dragging, dropPos, onDragStart, onDragEnd, onDragOver, onDrop, onPatch, onMove, onDelete }: StatusRowProps) {
  const t = m.settingsWorkspace.workflow;
  const rowRef = useRef<HTMLLIElement | null>(null);
  return (
    <li
      ref={rowRef}
      data-testid="status-row"
      data-status-name={status.name}
      onDragOver={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pos: DropPos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        if (onDragOver(pos)) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={clsx(
        'relative flex h-10 items-center gap-2 border-t border-border px-2 first:border-t-0 hover:bg-sunken',
        dragging && 'opacity-50',
        dropPos === 'before' && 'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary',
        dropPos === 'after' && 'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary',
      )}
    >
      <span
        draggable
        role="img"
        aria-label={t.dragHandle(status.name)}
        title={t.dragHandle(status.name)}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', status.id);
          if (rowRef.current) e.dataTransfer.setDragImage(rowRef.current, 16, 16);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-fg-subtlest hover:text-fg-subtle active:cursor-grabbing"
      >
        <Icon name="drag-handle" />
      </span>
      <ColorButton status={status} onPick={(color) => onPatch({ color })} />
      <InlineText
        value={status.name}
        label={t.nameLabel(status.name)}
        className="w-48 shrink-0 font-medium text-fg"
        onCommit={(v) => {
          if (v.length > 0 && v.length <= 32 && v !== status.name) onPatch({ name: v });
        }}
        maxLength={32}
        required
      />
      <InlineText
        value={status.description ?? ''}
        label={t.descriptionLabel(status.name)}
        placeholder={t.descriptionPlaceholder}
        className="min-w-0 flex-1 text-fg-subtle"
        onCommit={(v) => {
          if (v !== (status.description ?? '')) onPatch({ description: v || null });
        }}
        maxLength={200}
      />
      <DropdownMenu
        aria-label={t.actionsFor(status.name)}
        placement="bottom-end"
        trigger={<IconButton label={t.actionsFor(status.name)} size="sm" variant="subtle" icon={<Icon name="more" />} />}
      >
        <MenuItem icon={<Icon name="arrow-up" />} disabled={first} onSelect={() => onMove(-1)}>
          {t.moveUp}
        </MenuItem>
        <MenuItem icon={<Icon name="arrow-down" />} disabled={last} onSelect={() => onMove(1)}>
          {t.moveDown}
        </MenuItem>
        <MenuItem icon={<Icon name="trash" />} danger disabled={!deletable} onSelect={onDelete}>
          {t.delete}
        </MenuItem>
      </DropdownMenu>
    </li>
  );
}

/** Text that reads as plain text until focused; commits on blur or Enter, reverts on Escape. */
function InlineText({
  value,
  onCommit,
  label,
  placeholder,
  className,
  maxLength,
  required,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  maxLength?: number;
  required?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const v = (draft ?? value).trim();
    setDraft(null);
    if (v.length > 0 || !required) onCommit(v);
  };
  return (
    <input
      aria-label={label}
      value={draft ?? value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className={clsx(
        'h-8 truncate rounded-sm border border-transparent bg-transparent px-2 text-base placeholder:text-fg-subtlest hover:border-border focus:border-primary focus:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        className,
      )}
    />
  );
}

function ColorButton({ status, onPick }: { status: StatusFieldsFragment; onPick: (c: PaletteColor) => void }) {
  const t = m.settingsWorkspace.workflow;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        ref={setAnchor}
        aria-label={t.colorLabel(status.name)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm hover:bg-hover"
      >
        <StatusIcon category={status.category} color={status.color} size={16} label="" />
      </button>
      <Popover anchorEl={anchor} open={open} onDismiss={() => setOpen(false)} placement="bottom-start" className="p-2">
        <PaletteSwatches
          value={status.color}
          label={t.colorLabel(status.name)}
          onChange={(c) => {
            onPick(c);
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

function AddStatus({ team, category, disabled }: { team: TeamFieldsFragment; category: StatusCategory; disabled: boolean }) {
  const t = m.settingsWorkspace.workflow;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<PaletteColor>(DEFAULT_COLOR[category]);
  const [create, { loading }] = useOptimisticMutation(CreateStatusDocument, {
    optimistic: { serverConfirmed: 'The server mints the status id and its order within the category.' },
    rollback: () => t.flag.create,
    refetchQueries: ['Bootstrap'],
  });
  const submit = async () => {
    const v = name.trim();
    if (!v || v.length > 32) return;
    const res = await create({ teamId: team.id, input: { name: v, category, color } });
    if (res.data) {
      setOpen(false);
      setName('');
    }
  };
  return (
    <>
      <Button size="sm" variant="subtle" disabled={disabled} iconBefore={<Icon name="add" />} aria-label={t.addIn(t.categories[category])} onClick={() => setOpen(true)}>
        {t.add}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={t.addIn(t.categories[category])}
        onSubmit={() => void submit()}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{m.common.cancel}</Button>
            <Button variant="primary" loading={loading} disabled={name.trim().length === 0} onClick={() => void submit()}>
              {t.add}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <TextField label={t.newName} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} data-autofocus />
          <PaletteSwatches value={color} onChange={setColor} label={m.common.color} />
        </div>
      </Modal>
    </>
  );
}

function DeleteStatusModal({ status, siblings, onClose }: { status: StatusFieldsFragment; siblings: StatusFieldsFragment[]; onClose: () => void }) {
  const t = m.settingsWorkspace.workflow;
  const sorted = [...siblings.filter((s) => s.category === status.category), ...siblings.filter((s) => s.category !== status.category)];
  const [target, setTarget] = useState(sorted[0]?.id ?? '');
  const [del, { loading }] = useOptimisticMutation(DeleteStatusDocument, {
    optimistic: { serverConfirmed: 'Issues are reassigned on the server before the status is removed.' },
    rollback: () => t.flag.delete,
    refetchQueries: ['Bootstrap'],
  });
  const submit = async () => {
    const res = await del({ id: status.id, replacementStatusId: target || null });
    if (res.data) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t.deleteTitle(status.name)}
      description={t.deleteBody}
      footer={
        <>
          <Button onClick={onClose}>{m.common.cancel}</Button>
          <Button variant="danger" loading={loading} onClick={() => void submit()}>
            {t.deleteConfirm}
          </Button>
        </>
      }
    >
      <Select id="status-delete-replacement" label={t.deleteMoveTo} value={target} onChange={(e) => setTarget(e.target.value)} options={sorted.map((s) => ({ value: s.id, label: `${t.categories[s.category]} / ${s.name}` }))} />
    </Modal>
  );
}
