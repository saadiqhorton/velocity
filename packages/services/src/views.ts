import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { favorites, views } from '@velocity/schema';
import type { FavoriteKind, PaletteColor, ViewDisplay } from '@velocity/schema';
import { VIEW_GROUPINGS, VIEW_LAYOUTS, VIEW_ORDERINGS } from '@velocity/schema';
import { publish } from '@velocity/events';
import { ServiceBase } from './base';
import type { ServiceActor } from './context';
import { ServiceError, notFound, validation } from './errors';
import { orderBetween } from './lib/fractional-order';
import { randomToken } from './lib/crypto';
import { slugify } from './lib/identifiers';
import { assertCan } from './lib/permissions';

export type ViewRow = typeof views.$inferSelect;
export type FavoriteRow = typeof favorites.$inferSelect;

export const DEFAULT_DISPLAY: ViewDisplay = {
  grouping: 'status',
  ordering: 'priority',
  layout: 'list',
  columns: ['priority', 'identifier', 'title', 'labels', 'project', 'assignee'],
  showSubIssues: true,
  showEmptyGroups: false,
  showCompleted: 'all',
};

export function normalizeDisplay(d: Partial<ViewDisplay> | null | undefined): ViewDisplay {
  const out: ViewDisplay = { ...DEFAULT_DISPLAY, ...(d ?? {}) };
  if (!VIEW_GROUPINGS.includes(out.grouping)) throw validation('Unknown grouping.', { field: 'display.grouping' });
  if (!VIEW_ORDERINGS.includes(out.ordering)) throw validation('Unknown ordering.', { field: 'display.ordering' });
  if (!VIEW_LAYOUTS.includes(out.layout)) throw validation('Unknown layout.', { field: 'display.layout' });
  if (!Array.isArray(out.columns) || out.columns.some((c) => typeof c !== 'string')) throw validation('Columns must be a list of names.');
  return out;
}

/**
 * Saved views (SPEC §3.10): personal only in v1.1; shared by URL. The filter is stored as
 * canonical DSL — the caller (GraphQL) parses & validates it before saving.
 */
export class ViewService extends ServiceBase {
  async list(actor: ServiceActor, opts: { teamId?: string | null } = {}): Promise<ViewRow[]> {
    return this.db
      .select()
      .from(views)
      .where(and(eq(views.ownerId, actor.userId), opts.teamId ? eq(views.teamId, opts.teamId) : undefined))
      .orderBy(asc(views.name));
  }

  /** Views are reachable by anyone with the link (SPEC §3.10 "sharing happens by URL"). */
  async get(idOrSlug: string): Promise<ViewRow | null> {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
    const [v] = await this.db.select().from(views).where(isUuid ? eq(views.id, idOrSlug) : eq(views.slug, idOrSlug));
    return v ?? null;
  }

  async getMany(ids: readonly string[]): Promise<ViewRow[]> {
    if (!ids.length) return [];
    return this.db.select().from(views).where(inArray(views.id, [...ids]));
  }

  async create(
    actor: ServiceActor,
    input: { name: string; dsl: string; display?: Partial<ViewDisplay> | null; teamId?: string | null; icon?: string | null; color?: PaletteColor | null },
  ): Promise<ViewRow> {
    assertCan(actor, 'view.write');
    const name = input.name.trim();
    if (!name || name.length > 64) throw validation('View names are 1–64 characters.', { field: 'name' });
    const slug = `${slugify(name) || 'view'}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6)}`;
    const [row] = await this.db
      .insert(views)
      .values({
        name,
        slug,
        teamId: input.teamId ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        filter: { dsl: input.dsl },
        display: normalizeDisplay(input.display),
        ownerId: actor.userId,
      })
      .returning();
    if (!row) throw new Error('view insert failed');
    await publish(this.db, 'view.updated', { viewId: row.id, ownerId: actor.userId });
    return row;
  }

  async update(
    actor: ServiceActor,
    id: string,
    patch: { name?: string | null; dsl?: string | null; display?: Partial<ViewDisplay> | null; icon?: string | null; color?: PaletteColor | null; teamId?: string | null },
  ): Promise<ViewRow> {
    assertCan(actor, 'view.write');
    const v = await this.get(id);
    if (!v) throw notFound('View');
    if (v.ownerId !== actor.userId) throw new ServiceError('FORBIDDEN', 'Only the view’s owner can change it. Save a copy instead.');
    const set: Partial<typeof views.$inferInsert> = { updatedAt: this.now() };
    if (patch.name != null) {
      const n = patch.name.trim();
      if (!n || n.length > 64) throw validation('View names are 1–64 characters.', { field: 'name' });
      set.name = n;
    }
    if (patch.dsl != null) set.filter = { dsl: patch.dsl };
    if (patch.display) set.display = normalizeDisplay({ ...v.display, ...patch.display });
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.color !== undefined) set.color = patch.color;
    if (patch.teamId !== undefined) set.teamId = patch.teamId;
    const [row] = await this.db.update(views).set(set).where(eq(views.id, v.id)).returning();
    await publish(this.db, 'view.updated', { viewId: v.id, ownerId: actor.userId });
    return row!;
  }

  async delete(actor: ServiceActor, id: string): Promise<void> {
    assertCan(actor, 'view.write');
    const v = await this.get(id);
    if (!v) throw notFound('View');
    if (v.ownerId !== actor.userId) throw new ServiceError('FORBIDDEN', 'Only the view’s owner can delete it.');
    await this.db.delete(favorites).where(and(eq(favorites.kind, 'view'), eq(favorites.targetId, v.id)));
    await this.db.delete(views).where(eq(views.id, v.id));
    await publish(this.db, 'view.updated', { viewId: v.id, ownerId: actor.userId });
  }

  // ───────────── Favorites (orderable, SPEC §4.10.3) ─────────────

  async favorites(actor: ServiceActor): Promise<FavoriteRow[]> {
    if (!actor.userId) return [];
    return this.db.select().from(favorites).where(eq(favorites.userId, actor.userId)).orderBy(asc(favorites.sortOrder), desc(favorites.createdAt));
  }

  async addFavorite(actor: ServiceActor, kind: FavoriteKind, targetId: string): Promise<FavoriteRow> {
    if (!actor.userId) throw validation('Only members have favorites.');
    const [m] = await this.db.select({ m: max(favorites.sortOrder) }).from(favorites).where(eq(favorites.userId, actor.userId));
    const [row] = await this.db
      .insert(favorites)
      .values({ userId: actor.userId, kind, targetId, sortOrder: (m?.m ?? 0) + 1000 })
      .onConflictDoUpdate({ target: [favorites.userId, favorites.kind, favorites.targetId], set: { kind } })
      .returning();
    return row!;
  }

  async removeFavorite(actor: ServiceActor, id: string): Promise<void> {
    await this.db.delete(favorites).where(and(eq(favorites.id, id), eq(favorites.userId, actor.userId)));
  }

  async reorderFavorite(actor: ServiceActor, id: string, beforeId: string | null, afterId: string | null): Promise<FavoriteRow> {
    const ids = [beforeId, afterId].filter((x): x is string => Boolean(x));
    const n = ids.length ? await this.db.select().from(favorites).where(and(inArray(favorites.id, ids), eq(favorites.userId, actor.userId))) : [];
    const [row] = await this.db
      .update(favorites)
      .set({ sortOrder: orderBetween(n.find((x) => x.id === beforeId)?.sortOrder ?? null, n.find((x) => x.id === afterId)?.sortOrder ?? null) })
      .where(and(eq(favorites.id, id), eq(favorites.userId, actor.userId)))
      .returning();
    if (!row) throw notFound('Favorite');
    return row;
  }
}
