import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { comments, issues, reactions, subscriptions, users } from '@velocity/schema';
import { publish } from '@velocity/events';
import { ServiceBase } from './base';
import type { ServiceActor } from './context';
import { actorUserId, toActorRef } from './context';
import type { Tx } from './db';
import { ServiceError, notFound, validation } from './errors';
import { extractMentions, sanitizeMarkdown } from './lib/markdown';
import { assertCan } from './lib/permissions';

export type CommentRow = typeof comments.$inferSelect;
export type ReactionRow = typeof reactions.$inferSelect;

const MAX_COMMENT = 65_536;
/** Reactions are a curated set so the emoji picker stays small and searchable. */
export const REACTION_EMOJI = ['👍', '👎', '❤️', '🎉', '😄', '😕', '👀', '🚀'] as const;

export class CommentService extends ServiceBase {
  async listForIssue(issueId: string, opts: { includeDeleted?: boolean } = {}): Promise<CommentRow[]> {
    return this.db
      .select()
      .from(comments)
      .where(and(eq(comments.issueId, issueId), opts.includeDeleted ? undefined : isNull(comments.deletedAt)))
      .orderBy(asc(comments.createdAt));
  }

  async listForIssues(issueIds: readonly string[]): Promise<CommentRow[]> {
    if (!issueIds.length) return [];
    return this.db
      .select()
      .from(comments)
      .where(and(inArray(comments.issueId, [...issueIds]), isNull(comments.deletedAt)))
      .orderBy(asc(comments.createdAt));
  }

  async get(id: string): Promise<CommentRow | null> {
    const [c] = await this.db.select().from(comments).where(eq(comments.id, id));
    return c ?? null;
  }

  async reactionsFor(commentIds: readonly string[]): Promise<ReactionRow[]> {
    if (!commentIds.length) return [];
    return this.db.select().from(reactions).where(inArray(reactions.commentId, [...commentIds]));
  }

  async create(
    actor: ServiceActor,
    input: { issueId: string; bodyMd: string; id?: string | null },
    opts: { source?: 'app' | 'github' | 'import'; authorName?: string | null; createdAt?: Date | null; tx?: Tx } = {},
  ): Promise<CommentRow> {
    assertCan(actor, 'issue.write');
    const body = sanitizeMarkdown(input.bodyMd ?? '').trim();
    if (!body) throw validation('Write something before posting.', { field: 'bodyMd' });
    if (body.length > MAX_COMMENT) throw validation('Comments are limited to 64 KB.', { field: 'bodyMd' });
    const run = async (tx: Tx): Promise<CommentRow> => {
      const [issue] = await tx.select().from(issues).where(eq(issues.id, input.issueId));
      if (!issue || issue.trashedAt) throw notFound('Issue');
      const [row] = await tx
        .insert(comments)
        .values({
          ...(input.id ? { id: input.id } : {}),
          issueId: issue.id,
          authorId: actorUserId(actor),
          authorName: opts.authorName ?? null,
          source: opts.source ?? 'app',
          bodyMd: body,
          ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        })
        .returning();
      if (!row) throw new Error('comment insert failed');
      // Mentions resolve to members; mentioned members and the author get subscribed (SPEC §3.5.4, §3.11).
      const mentionNames = extractMentions(body);
      const mentioned = mentionNames.length
        ? await tx.select({ id: users.id }).from(users).where(and(inArray(users.username, mentionNames), isNull(users.deletedAt)))
        : [];
      const subs = new Set([actorUserId(actor), ...mentioned.map((m) => m.id)].filter((x): x is string => Boolean(x)));
      if (subs.size && opts.source !== 'import') {
        await tx.insert(subscriptions).values([...subs].map((userId) => ({ issueId: issue.id, userId }))).onConflictDoNothing();
      }
      await tx.update(issues).set({ updatedAt: this.now() }).where(eq(issues.id, issue.id));
      if (opts.source !== 'import') {
        await publish(tx, 'comment.created', {
          commentId: row.id,
          issueId: issue.id,
          teamId: issue.teamId,
          mentions: mentioned.map((m) => m.id),
          actor: toActorRef(actor),
        });
      }
      return row;
    };
    return opts.tx ? run(opts.tx) : this.tx(run);
  }

  /** Editable by author only (SPEC §3.5.4). */
  async update(actor: ServiceActor, id: string, bodyMd: string): Promise<CommentRow> {
    assertCan(actor, 'issue.write');
    const c = await this.get(id);
    if (!c || c.deletedAt) throw notFound('Comment');
    if (c.authorId !== actor.userId) throw new ServiceError('FORBIDDEN', 'Only the author can edit a comment.');
    const body = sanitizeMarkdown(bodyMd).trim();
    if (!body) throw validation('A comment can’t be empty. Delete it instead.', { field: 'bodyMd' });
    if (body.length > MAX_COMMENT) throw validation('Comments are limited to 64 KB.', { field: 'bodyMd' });
    return this.tx(async (tx) => {
      const [row] = await tx.update(comments).set({ bodyMd: body, editedAt: this.now() }).where(eq(comments.id, id)).returning();
      await publish(tx, 'comment.updated', { commentId: id, issueId: c.issueId, actor: toActorRef(actor) });
      return row!;
    });
  }

  /** Soft delete; authors delete their own, the owner can delete any (moderation). */
  async delete(actor: ServiceActor, id: string): Promise<void> {
    assertCan(actor, 'issue.write');
    const c = await this.get(id);
    if (!c || c.deletedAt) throw notFound('Comment');
    if (c.authorId !== actor.userId && !actor.isOwner) throw new ServiceError('FORBIDDEN', 'Only the author can delete a comment.');
    await this.tx(async (tx) => {
      await tx.update(comments).set({ deletedAt: this.now() }).where(eq(comments.id, id));
      await publish(tx, 'comment.deleted', { commentId: id, issueId: c.issueId, actor: toActorRef(actor) });
    });
  }

  async toggleReaction(actor: ServiceActor, commentId: string, emoji: string): Promise<boolean> {
    assertCan(actor, 'issue.write');
    if (!actor.userId) throw validation('Only members can react.');
    if (!(REACTION_EMOJI as readonly string[]).includes(emoji)) throw validation('Pick a reaction from the list.', { field: 'emoji' });
    const c = await this.get(commentId);
    if (!c || c.deletedAt) throw notFound('Comment');
    const removed = await this.db
      .delete(reactions)
      .where(and(eq(reactions.commentId, commentId), eq(reactions.userId, actor.userId), eq(reactions.emoji, emoji)))
      .returning();
    if (!removed.length) await this.db.insert(reactions).values({ commentId, userId: actor.userId, emoji }).onConflictDoNothing();
    await publish(this.db, 'comment.updated', { commentId, issueId: c.issueId, actor: toActorRef(actor) });
    return removed.length === 0;
  }
}
