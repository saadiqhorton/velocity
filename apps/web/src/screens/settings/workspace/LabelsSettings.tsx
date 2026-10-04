import { useState } from 'react';
import clsx from 'clsx';
import { Button, ConfirmDialog, EmptyState, Icon, IconButton, Popover, Select, TextField } from '@velocity/ui';
import { CreateLabelDocument, DeleteLabelDocument, UpdateLabelDocument } from '@/gql/graphql';
import type { LabelFieldsFragment, PaletteColor } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useOptimisticMutation } from '@/lib/mutation';
import { ColorDot } from '@/components/common/EntityIcons';
import { SettingsPage } from '../common';
import { PaletteSwatches } from './shared';
import { m } from '@/i18n';

type Label = LabelFieldsFragment;

interface Draft {
  name: string;
  color: PaletteColor;
  description: string;
  parentId: string;
  isGroup: boolean;
}

const EMPTY_DRAFT: Draft = { name: '', color: 'blue', description: '', parentId: '', isGroup: false };

export function LabelsSettings() {
  const t = m.settingsWorkspace.labels;
  const { labels } = useWorkspace();
  const [creating, setCreating] = useState<null | { isGroup: boolean }>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Label | null>(null);

  const byId = new Map(labels.map((l) => [l.id, l]));
  const groups = labels.filter((l) => l.isGroup);
  const childrenOf = (id: string) => labels.filter((l) => !l.isGroup && l.parentId === id);
  const ungrouped = labels.filter((l) => !l.isGroup && (!l.parentId || !byId.get(l.parentId)?.isGroup));

  const [update] = useOptimisticMutation(UpdateLabelDocument, {
    optimistic: (vars) => {
      const cur = byId.get(vars.id);
      if (!cur) throw new Error('label not cached');
      return {
        __typename: 'Mutation' as const,
        updateLabel: {
          ...cur,
          name: vars.input.name ?? cur.name,
          color: vars.input.color ?? cur.color,
          description: vars.input.description !== undefined ? vars.input.description : cur.description,
          parentId: vars.input.parentId !== undefined ? vars.input.parentId : cur.parentId,
        },
      };
    },
    rollback: () => t.flag.update,
    silent: (code) => code === 'CONFLICT',
    refetchQueries: ['Bootstrap'],
  });
  const [create, { loading: creatingLoading }] = useOptimisticMutation(CreateLabelDocument, {
    optimistic: { serverConfirmed: 'The server mints the label id.' },
    rollback: () => t.flag.create,
    silent: (code) => code === 'CONFLICT',
    refetchQueries: ['Bootstrap'],
  });
  const [del, { loading: deletingLoading }] = useOptimisticMutation(DeleteLabelDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, deleteLabel: true }),
    rollback: () => t.flag.delete,
    update: (cache, _res, vars) => {
      cache.evict({ id: cache.identify({ __typename: 'Label', id: vars.id }) });
      cache.gc();
    },
    refetchQueries: ['Bootstrap'],
  });

  const submitCreate = async (draft: Draft): Promise<string | null> => {
    const res = await create({
      input: {
        name: draft.name.trim(),
        color: draft.color,
        description: draft.description.trim() || null,
        isGroup: draft.isGroup,
        parentId: draft.isGroup ? null : draft.parentId || null,
      },
    });
    if (res.data) {
      setCreating(null);
      return null;
    }
    return res.error?.code === 'CONFLICT' ? t.nameTaken : (res.error?.message ?? null);
  };
  const submitEdit = async (label: Label, draft: Draft): Promise<string | null> => {
    const res = await update({
      id: label.id,
      input: {
        name: draft.name.trim(),
        color: draft.color,
        description: draft.description.trim() || null,
        ...(label.isGroup ? {} : { parentId: draft.parentId || null }),
      },
    });
    if (res.data) {
      setEditingId(null);
      return null;
    }
    return res.error?.code === 'CONFLICT' ? t.nameTaken : (res.error?.message ?? null);
  };

  const renderRow = (label: Label, indent: boolean) =>
    editingId === label.id ? (
      <li key={label.id} className="border-t border-border first:border-t-0">
        <LabelEditor
          initial={{ name: label.name, color: label.color, description: label.description ?? '', parentId: label.parentId ?? '', isGroup: label.isGroup }}
          groups={groups.filter((g) => g.id !== label.id)}
          submitLabel={m.common.save}
          onSubmit={(d) => submitEdit(label, d)}
          onCancel={() => setEditingId(null)}
        />
      </li>
    ) : (
      <LabelRow
        key={label.id}
        label={label}
        indent={indent}
        childCount={label.isGroup ? childrenOf(label.id).length : 0}
        onEdit={() => {
          setCreating(null);
          setEditingId(label.id);
        }}
        onDelete={() => setDeleting(label)}
      />
    );

  const startCreate = (isGroup: boolean) => {
    setEditingId(null);
    setCreating({ isGroup });
  };

  const createButtons = (
    <>
      <Button iconBefore={<Icon name="add" />} onClick={() => startCreate(true)}>
        {t.newGroup}
      </Button>
      <Button variant="primary" iconBefore={<Icon name="add" />} onClick={() => startCreate(false)}>
        {t.newLabel}
      </Button>
    </>
  );

  return (
    <SettingsPage title={m.settings.sections.labels} description={t.description} actions={createButtons} testId="settings-labels">
      <div className="overflow-hidden rounded-md border border-border" data-testid="labels-list">
        {creating ? (
          <div className="border-b border-border">
            <LabelEditor
              key={creating.isGroup ? 'group' : 'label'}
              initial={{ ...EMPTY_DRAFT, isGroup: creating.isGroup, color: creating.isGroup ? 'grey' : 'blue' }}
              groups={groups}
              submitLabel={m.common.create}
              loading={creatingLoading}
              onSubmit={submitCreate}
              onCancel={() => setCreating(null)}
            />
          </div>
        ) : null}
        {labels.length === 0 && !creating ? (
          <EmptyState icon="label" message={t.empty} action={<Button variant="primary" onClick={() => startCreate(false)}>{t.emptyAction}</Button>} />
        ) : (
          <ul aria-label={t.tableLabel}>
            {groups.map((g) => (
              <li key={g.id} className="border-t border-border first:border-t-0">
                <ul>
                  {renderRow(g, false)}
                  {childrenOf(g.id).map((c) => renderRow(c, true))}
                </ul>
              </li>
            ))}
            {ungrouped.length > 0 && groups.length > 0 ? (
              <li className="border-t border-border bg-sunken px-4 py-1 text-xs font-semibold uppercase text-fg-subtle">{t.ungrouped}</li>
            ) : null}
            {ungrouped.map((l) => renderRow(l, false))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? t.deleteTitle(deleting.name) : ''}
        description={deleting ? (deleting.isGroup ? t.deleteGroupBody(childrenOf(deleting.id).length) : t.deleteBody) : undefined}
        confirmLabel={t.deleteConfirm}
        loading={deletingLoading}
        onConfirm={() => {
          if (!deleting) return;
          void del({ id: deleting.id }).then((r) => {
            if (r.data) setDeleting(null);
          });
        }}
      />
    </SettingsPage>
  );
}

function LabelRow({ label, indent, childCount, onEdit, onDelete }: { label: Label; indent: boolean; childCount: number; onEdit: () => void; onDelete: () => void }) {
  const t = m.settingsWorkspace.labels;
  return (
    <li
      data-testid="label-row"
      data-label-name={label.name}
      className={clsx('group flex min-h-10 items-center gap-3 border-t border-border py-1 pr-2 first:border-t-0 hover:bg-sunken', indent ? 'pl-10' : 'pl-4')}
    >
      {label.isGroup ? <Icon name="label" className="text-fg-subtle" /> : <ColorDot color={label.color} size={10} />}
      <span className={clsx('truncate text-base text-fg', label.isGroup ? 'font-semibold' : 'font-medium')}>{label.name}</span>
      {label.isGroup ? (
        <span className="text-sm text-fg-subtlest">
          {t.groupBadge} · {childCount}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-sm text-fg-subtle">{label.description}</span>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100">
        <IconButton label={t.edit(label.name)} size="sm" variant="subtle" icon={<Icon name="edit" />} onClick={onEdit} />
        <IconButton label={t.delete(label.name)} size="sm" variant="subtle" icon={<Icon name="trash" />} onClick={onDelete} />
      </div>
    </li>
  );
}

function LabelEditor({
  initial,
  groups,
  submitLabel,
  loading,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  groups: Label[];
  submitLabel: string;
  loading?: boolean;
  onSubmit: (d: Draft) => Promise<string | null>;
  onCancel: () => void;
}) {
  const t = m.settingsWorkspace.labels;
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const valid = draft.name.trim().length > 0;
  const submit = async () => {
    if (!valid) return;
    setError(await onSubmit(draft));
  };
  return (
    <form
      className="flex flex-col gap-3 bg-sunken p-4"
      data-testid="label-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="flex items-end gap-2">
        <button
          type="button"
          ref={setColorAnchor}
          aria-label={`${t.color}: ${m.settingsWorkspace.colors[draft.color]}`}
          aria-haspopup="dialog"
          aria-expanded={colorOpen}
          onClick={() => setColorOpen((v) => !v)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-border-input bg-surface hover:bg-hover"
        >
          <ColorDot color={draft.color} size={10} />
        </button>
        <Popover anchorEl={colorAnchor} open={colorOpen} onDismiss={() => setColorOpen(false)} placement="bottom-start" className="p-2">
          <PaletteSwatches
            value={draft.color}
            label={t.color}
            onChange={(color) => {
              setDraft((d) => ({ ...d, color }));
              setColorOpen(false);
            }}
          />
        </Popover>
        <div className="min-w-0 flex-1">
          <TextField
            aria-label={t.name}
            placeholder={t.namePlaceholder}
            value={draft.name}
            maxLength={64}
            invalid={error !== null}
            onChange={(e) => {
              setError(null);
              setDraft((d) => ({ ...d, name: e.target.value }));
            }}
            autoFocus
          />
        </div>
        {!draft.isGroup ? (
          <div className="w-44 shrink-0">
            <Select
              aria-label={t.group}
              value={draft.parentId}
              onChange={(e) => setDraft((d) => ({ ...d, parentId: e.target.value }))}
              options={[{ value: '', label: t.noGroup }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
            />
          </div>
        ) : null}
      </div>
      <TextField
        aria-label={t.description_}
        placeholder={t.descriptionPlaceholder}
        value={draft.description}
        maxLength={200}
        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
      />
      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onCancel}>{m.common.cancel}</Button>
        <Button type="submit" variant="primary" loading={loading} disabled={!valid}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
