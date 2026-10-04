import { useRef, useState } from 'react';
import { useQuery } from '@apollo/client';
import type { Reference } from '@apollo/client';
import clsx from 'clsx';
import { Avatar, Button, ConfirmDialog, DropdownMenu, Icon, IconButton, MenuItem, Popover, Skeleton } from '@velocity/ui';
import {
  CreateCommentDocument,
  DeleteCommentDocument,
  IssueCommentsDocument,
  ToggleReactionDocument,
  UpdateCommentDocument,
} from '@/gql/graphql';
import type { CommentFieldsFragment } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useOptimisticMutation } from '@/lib/mutation';
import { formatDateTime, formatRelative } from '@/lib/format';
import { LazyEditor } from '@/components/editor/LazyEditor';
import type { MarkdownEditorHandle } from '@/components/editor/LazyEditor';
import { MarkdownView } from '@/components/editor/MarkdownView';
import { ShortcutHint } from '@/components/common/ShortcutHint';
import { m } from '@/i18n';

function ReactionBar({ comment, emoji }: { comment: CommentFieldsFragment; emoji: readonly string[] }) {
  const { viewer } = useWorkspace();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [toggle] = useOptimisticMutation(ToggleReactionDocument, {
    optimistic: (vars) => {
      const existing = comment.reactions.find((r) => r.emoji === vars.emoji);
      const reactions = existing
        ? comment.reactions
            .map((r) =>
              r.emoji === vars.emoji
                ? {
                    ...r,
                    reacted: !r.reacted,
                    count: r.count + (r.reacted ? -1 : 1),
                    userIds: r.reacted ? r.userIds.filter((u) => u !== viewer.id) : [...r.userIds, viewer.id],
                  }
                : r,
            )
            .filter((r) => r.count > 0)
        : [...comment.reactions, { __typename: 'ReactionGroup' as const, emoji: vars.emoji, count: 1, reacted: true, userIds: [viewer.id] }];
      return { __typename: 'Mutation' as const, toggleReaction: { __typename: 'Comment' as const, id: comment.id, reactions } };
    },
    rollback: () => m.flags.rollback.comment,
  });
  return (
    <div className="flex flex-wrap items-center gap-1">
      {comment.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          aria-label={`${r.emoji} ${r.count}`}
          aria-pressed={r.reacted}
          onClick={() => void toggle({ commentId: comment.id, emoji: r.emoji })}
          className={clsx(
            'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-sm transition-colors duration-100',
            r.reacted ? 'border-primary bg-primary-subtle text-fg' : 'border-border text-fg-subtle hover:bg-hover',
          )}
        >
          <span aria-hidden="true">{r.emoji}</span>
          {r.count}
        </button>
      ))}
      <IconButton ref={setAnchor} label={m.issue.addReaction} size="sm" icon={<Icon name="sparkle" />} onClick={() => setOpen(!open)} />
      <Popover anchorEl={anchor} open={open} onDismiss={() => setOpen(false)} placement="bottom-start" className="grid grid-cols-6 gap-1 p-2">
        {emoji.map((e) => (
          <button
            key={e}
            type="button"
            aria-label={e}
            onClick={() => {
              setOpen(false);
              void toggle({ commentId: comment.id, emoji: e });
            }}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-lg hover:bg-hover"
          >
            {e}
          </button>
        ))}
      </Popover>
    </div>
  );
}

function CommentItem({ comment, emoji }: { comment: CommentFieldsFragment; emoji: readonly string[] }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const editor = useRef<MarkdownEditorHandle>(null);
  const [update] = useOptimisticMutation(UpdateCommentDocument, {
    optimistic: (vars) => ({ __typename: 'Mutation' as const, updateComment: { ...comment, bodyMd: vars.bodyMd, editedAt: new Date().toISOString() } }),
    rollback: () => m.flags.rollback.comment,
  });
  const [remove] = useOptimisticMutation(DeleteCommentDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, deleteComment: true }),
    rollback: () => m.flags.rollback.comment,
    update: (cache) => {
      cache.modify({
        id: cache.identify({ __typename: 'Issue' as const, id: comment.issueId }),
        fields: {
          comments: (existing: readonly { __ref: string }[] = [], { readField }) => existing.filter((c) => readField('id', c) !== comment.id),
          commentCount: (n: number) => Math.max(0, n - 1),
        },
      });
    },
  });
  const author = comment.author?.name ?? comment.authorName ?? m.common.unknown;
  const mine = comment.author?.isMe ?? false;
  return (
    <article className="group/comment flex gap-3" data-testid="comment">
      <Avatar name={author} src={comment.author?.avatarUrl} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-center gap-2">
          <span className="text-base font-medium text-fg">{author}</span>
          <time className="text-sm text-fg-subtlest" dateTime={comment.createdAt} title={formatDateTime(comment.createdAt)}>
            {formatRelative(comment.createdAt)}
          </time>
          {comment.editedAt ? <span className="text-sm text-fg-subtlest">({m.issue.edited})</span> : null}
          <span className="flex-1" />
          {mine && !editing ? (
            <span className="opacity-0 transition-opacity duration-100 group-hover/comment:opacity-100 focus-within:opacity-100">
              <DropdownMenu aria-label={m.common.more} placement="bottom-end" trigger={<IconButton label={m.common.more} size="sm" icon={<Icon name="more" />} />}>
                <MenuItem icon={<Icon name="edit" />} onSelect={() => setEditing(true)}>
                  {m.issue.editComment}
                </MenuItem>
                <MenuItem icon={<Icon name="trash" />} danger onSelect={() => setConfirm(true)}>
                  {m.issue.deleteComment}
                </MenuItem>
              </DropdownMenu>
            </span>
          ) : null}
        </div>
        {editing ? (
          <div className="mt-1 rounded-md border border-border-input px-3 py-2 focus-within:border-primary">
            <LazyEditor
              handle={editor}
              value={comment.bodyMd}
              ariaLabel={m.issue.editComment}
              autoFocus
              minHeight="sm"
              onSubmit={(md) => {
                setEditing(false);
                if (md.trim() && md !== comment.bodyMd) void update({ id: comment.id, bodyMd: md });
              }}
              onEscape={() => setEditing(false)}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" onClick={() => setEditing(false)}>
                {m.common.cancel}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const md = editor.current?.getMarkdown() ?? comment.bodyMd;
                  setEditing(false);
                  if (md.trim() && md !== comment.bodyMd) void update({ id: comment.id, bodyMd: md });
                }}
              >
                {m.common.save}
              </Button>
            </div>
          </div>
        ) : (
          <MarkdownView markdown={comment.bodyMd} className="mt-0.5" />
        )}
        {emoji.length > 0 ? (
          <div className="mt-2">
            <ReactionBar comment={comment} emoji={emoji} />
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        title={m.issue.deleteComment}
        confirmLabel={m.common.delete}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void remove({ id: comment.id });
        }}
      />
    </article>
  );
}

function Composer({ issueId }: { issueId: string }) {
  const { viewer } = useWorkspace();
  const editor = useRef<MarkdownEditorHandle>(null);
  const [empty, setEmpty] = useState(true);
  const [create] = useOptimisticMutation(CreateCommentDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      createComment: {
        __typename: 'Comment' as const,
        id: vars.id ?? crypto.randomUUID(),
        issueId: vars.issueId,
        bodyMd: vars.bodyMd,
        createdAt: new Date().toISOString(),
        editedAt: null,
        source: 'web',
        authorName: null,
        author: { __typename: 'User' as const, id: viewer.id, name: viewer.name, avatarUrl: viewer.avatarUrl, isMe: true },
        reactions: [],
      },
    }),
    rollback: () => m.flags.rollback.comment,
    update: (cache, result) => {
      const c = result.data?.createComment;
      if (!c) return;
      cache.modify({
        id: cache.identify({ __typename: 'Issue' as const, id: issueId }),
        fields: {
          comments: (value, { toReference }) => {
            const existing = (value ?? []) as readonly Reference[];
            const ref = toReference(c);
            return ref && !existing.some((e) => e.__ref === ref.__ref) ? [...existing, ref] : existing;
          },
          commentCount: (n: number, { readField }) => {
            void readField;
            return n + 1;
          },
        },
      });
    },
  });
  const submit = (md: string) => {
    if (!md.trim()) return;
    editor.current?.clear();
    setEmpty(true);
    void create({ issueId, bodyMd: md, id: crypto.randomUUID() });
  };
  return (
    <div className="flex gap-3">
      <Avatar name={viewer.name} src={viewer.avatarUrl} size={24} />
      <div className="min-w-0 flex-1 rounded-md border border-border-input bg-input px-3 py-2 transition-colors duration-100 focus-within:border-primary" data-testid="comment-composer">
        <LazyEditor
          handle={editor}
          value=""
          ariaLabel={m.issue.comment}
          placeholder={m.issue.commentPlaceholder}
          minHeight="sm"
          onChange={(md) => setEmpty(!md.trim())}
          onSubmit={submit}
          onEscape={() => (document.activeElement as HTMLElement | null)?.blur()}
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          <ShortcutHint binding="mod+enter" />
          <Button size="sm" variant="primary" disabled={empty} onClick={() => submit(editor.current?.getMarkdown() ?? '')}>
            {m.issue.comment}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Comments({ issueId }: { issueId: string }) {
  const { data, loading } = useQuery(IssueCommentsDocument, { variables: { id: issueId }, fetchPolicy: 'cache-and-network' });
  const comments = data?.issue?.comments ?? [];
  const emoji = data?.reactionEmoji ?? [];
  return (
    <div className="flex flex-col gap-5" data-testid="comments">
      {loading && !data ? <Skeleton rows={3} /> : null}
      {data && comments.length === 0 ? <p className="text-base text-fg-subtlest">{m.issue.noComments}</p> : null}
      {comments.map((c) => (
        <CommentItem key={c.id} comment={c} emoji={emoji} />
      ))}
      <Composer issueId={issueId} />
    </div>
  );
}
