import { eq } from 'drizzle-orm';
import { workspace } from '@velocity/schema';
import { publish } from '@velocity/events';
import { ServiceBase } from './base';
import type { AuditService } from './audit';
import type { ServiceActor } from './context';
import { toActorRef } from './context';
import { notFound, validation } from './errors';
import { slugify } from './lib/identifiers';
import { assertCan } from './lib/permissions';
import { assertTimezone } from './users';

export type WorkspaceRow = typeof workspace.$inferSelect;

/** Single workspace per deployment (SPEC §3.3). */
export class WorkspaceService extends ServiceBase {
  private audit!: AuditService;
  bind(audit: AuditService): void {
    this.audit = audit;
  }

  async get(): Promise<WorkspaceRow | null> {
    const [w] = await this.db.select().from(workspace).where(eq(workspace.id, 1));
    return w ?? null;
  }

  async update(actor: ServiceActor, patch: { name?: string | null; slug?: string | null; timezone?: string | null; locale?: string | null }): Promise<WorkspaceRow> {
    assertCan(actor, 'workspace.settings');
    const set: Partial<typeof workspace.$inferInsert> = { updatedAt: this.now() };
    if (patch.name != null) {
      const n = patch.name.trim();
      if (!n || n.length > 64) throw validation('Workspace name must be 1–64 characters.', { field: 'name' });
      set.name = n;
    }
    if (patch.slug != null) {
      const s = slugify(patch.slug);
      if (!s) throw validation('Use letters, numbers and dashes for the URL slug.', { field: 'slug' });
      set.slug = s;
    }
    if (patch.timezone != null) {
      assertTimezone(patch.timezone);
      set.timezone = patch.timezone;
    }
    if (patch.locale != null) set.locale = patch.locale.slice(0, 16);
    return this.tx(async (tx) => {
      const [w] = await tx.update(workspace).set(set).where(eq(workspace.id, 1)).returning();
      if (!w) throw notFound('Workspace');
      await this.audit.log(tx, actor, { action: 'workspace.updated', objectType: 'workspace', objectId: '1', changes: { ...patch } });
      await publish(tx, 'workspace.updated', { actor: toActorRef(actor) });
      return w;
    });
  }

  /** Owner-only, type-the-name confirmation; data retained 7 days then purged (SPEC §3.3). */
  async requestDeletion(actor: ServiceActor, confirmName: string): Promise<WorkspaceRow> {
    assertCan(actor, 'workspace.delete');
    const ws = await this.get();
    if (!ws) throw notFound('Workspace');
    if (confirmName.trim() !== ws.name) throw validation(`Type “${ws.name}” to confirm.`, { field: 'confirmName' });
    return this.tx(async (tx) => {
      const [w] = await tx.update(workspace).set({ deletionRequestedAt: this.now() }).where(eq(workspace.id, 1)).returning();
      await this.audit.log(tx, actor, { action: 'workspace.deletion_requested', objectType: 'workspace', objectId: '1' });
      return w!;
    });
  }

  async cancelDeletion(actor: ServiceActor): Promise<WorkspaceRow> {
    assertCan(actor, 'workspace.delete');
    return this.tx(async (tx) => {
      const [w] = await tx.update(workspace).set({ deletionRequestedAt: null }).where(eq(workspace.id, 1)).returning();
      if (!w) throw notFound('Workspace');
      await this.audit.log(tx, actor, { action: 'workspace.deletion_canceled', objectType: 'workspace', objectId: '1' });
      return w;
    });
  }
}
