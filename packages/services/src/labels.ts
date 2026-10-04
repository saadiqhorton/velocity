import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { labels } from '@velocity/schema';
import type { PaletteColor } from '@velocity/schema';
import { PALETTE_COLORS } from '@velocity/schema';
import { publish } from '@velocity/events';
import { ServiceBase } from './base';
import type { ServiceActor } from './context';
import { toActorRef } from './context';
import type { DbOrTx } from './db';
import { conflict, isUniqueViolation, notFound, validation } from './errors';
import { assertCan } from './lib/permissions';

export type LabelRow = typeof labels.$inferSelect;

/** SPEC §3.7 defaults: group "Type" (Bug, Feature, Improvement) + Design, Performance, Security. */
const DEFAULT_LABELS: { name: string; color: PaletteColor; group?: string }[] = [
  { name: 'Bug', color: 'red', group: 'Type' },
  { name: 'Feature', color: 'purple', group: 'Type' },
  { name: 'Improvement', color: 'blue', group: 'Type' },
  { name: 'Design', color: 'pink' },
  { name: 'Performance', color: 'yellow' },
  { name: 'Security', color: 'teal' },
];

export class LabelService extends ServiceBase {
  async list(): Promise<LabelRow[]> {
    return this.db.select().from(labels).where(isNull(labels.archivedAt)).orderBy(asc(labels.name));
  }

  async getMany(ids: readonly string[]): Promise<LabelRow[]> {
    if (!ids.length) return [];
    return this.db.select().from(labels).where(inArray(labels.id, [...ids]));
  }

  async byName(name: string, executor: DbOrTx = this.db): Promise<LabelRow | null> {
    const [l] = await executor.select().from(labels).where(sql`lower(${labels.name}) = lower(${name})`);
    return l ?? null;
  }

  async ensureDefaults(executor: DbOrTx = this.db): Promise<void> {
    const [{ n } = { n: 0 }] = await executor.select({ n: sql<number>`count(*)::int` }).from(labels);
    if (n > 0) return;
    const [group] = await executor.insert(labels).values({ name: 'Type', color: 'grey', isGroup: true }).returning();
    for (const l of DEFAULT_LABELS) {
      await executor
        .insert(labels)
        .values({ name: l.name, color: l.color, parentId: l.group && group ? group.id : null })
        .onConflictDoNothing();
    }
  }

  private validate(input: { name?: string; color?: PaletteColor | null; description?: string | null }): void {
    if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 48)) {
      throw validation('Label names are 1–48 characters.', { field: 'name' });
    }
    if (input.color && !PALETTE_COLORS.includes(input.color)) throw validation('Pick a color from the palette.', { field: 'color' });
    if (input.description && input.description.length > 500) throw validation('Description is too long.', { field: 'description' });
  }

  private async checkParent(parentId: string | null | undefined, selfId?: string): Promise<void> {
    if (!parentId) return;
    if (parentId === selfId) throw validation('A label can’t be its own group.');
    const [p] = await this.db.select().from(labels).where(eq(labels.id, parentId));
    if (!p || p.archivedAt) throw notFound('Label group');
    if (!p.isGroup) throw validation('Labels can only be nested under a label group.');
  }

  async create(
    actor: ServiceActor,
    input: { name: string; color?: PaletteColor | null; description?: string | null; parentId?: string | null; isGroup?: boolean | null },
  ): Promise<LabelRow> {
    assertCan(actor, 'issue.write');
    this.validate(input);
    await this.checkParent(input.parentId);
    try {
      const [row] = await this.db
        .insert(labels)
        .values({
          name: input.name.trim(),
          color: input.color ?? 'grey',
          description: input.description ?? null,
          parentId: input.isGroup ? null : (input.parentId ?? null),
          isGroup: Boolean(input.isGroup),
        })
        .returning();
      if (!row) throw new Error('label insert failed');
      await publish(this.db, 'label.updated', { labelId: row.id, actor: toActorRef(actor) });
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'labels_name_uq')) throw conflict(`A label named “${input.name.trim()}” already exists.`, { field: 'name' });
      throw err;
    }
  }

  async update(
    actor: ServiceActor,
    id: string,
    patch: { name?: string | null; color?: PaletteColor | null; description?: string | null; parentId?: string | null },
  ): Promise<LabelRow> {
    assertCan(actor, 'issue.write');
    this.validate({ name: patch.name ?? undefined, color: patch.color, description: patch.description });
    if (patch.parentId !== undefined) await this.checkParent(patch.parentId, id);
    const set: Partial<typeof labels.$inferInsert> = {};
    if (patch.name != null) set.name = patch.name.trim();
    if (patch.color) set.color = patch.color;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.parentId !== undefined) set.parentId = patch.parentId;
    try {
      const [row] = await this.db.update(labels).set(set).where(and(eq(labels.id, id), isNull(labels.archivedAt))).returning();
      if (!row) throw notFound('Label');
      await publish(this.db, 'label.updated', { labelId: id, actor: toActorRef(actor) });
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'labels_name_uq')) throw conflict('A label with that name already exists.', { field: 'name' });
      throw err;
    }
  }

  /** Hard delete: issue_labels rows cascade; children of a group become top-level. */
  async delete(actor: ServiceActor, id: string): Promise<void> {
    assertCan(actor, 'issue.write');
    const res = await this.db.delete(labels).where(eq(labels.id, id)).returning({ id: labels.id });
    if (!res.length) throw notFound('Label');
    await publish(this.db, 'label.updated', { labelId: id, actor: toActorRef(actor) });
  }
}
