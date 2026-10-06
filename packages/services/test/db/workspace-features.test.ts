import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { apiActor, createHarness, setupOwner, addMember } from '../helpers/harness';
import type { Harness } from '../helpers/harness';
import type { ServiceActor } from '../../src/index';

let h: Harness;
let owner: ServiceActor;
let member: ServiceActor;

beforeAll(async () => {
  h = await createHarness();
  owner = await setupOwner(h);
  member = await addMember(h, owner, 'workspace-member');
});
afterAll(async () => h.close());

describe('workspace feature switches', () => {
  it('preserves all features for a workspace created before migration 0004', async () => {
    const legacy = await createHarness();
    try {
      await setupOwner(legacy, 'legacy-owner');
      await legacy.pool.query('alter table workspace drop column features');
      const migration = readFileSync(new URL('../../../schema/migrations/0004_gray_wallop.sql', import.meta.url), 'utf8');
      await legacy.pool.query(migration);
      const result = await legacy.pool.query<{ features: Record<string, boolean> }>('select features from workspace where id = 1');
      expect(result.rows[0]?.features).toEqual({ cycles: true, estimates: true, insights: true, members: true });
      const defaults = await legacy.pool.query<{ column_default: string }>(
        "select column_default from information_schema.columns where table_name = 'workspace' and column_name = 'features'",
      );
      expect(defaults.rows[0]?.column_default).toContain('false');
    } finally {
      await legacy.close();
    }
  });

  it('starts new workspaces in solo mode, updates one switch at a time, and audits changes', async () => {
    expect((await h.services.workspace.get())?.features).toEqual({
      cycles: false, estimates: false, insights: false, members: false,
    });
    const updated = await h.services.workspace.updateFeatures(owner, { cycles: true });
    expect(updated.features).toEqual({ cycles: true, estimates: false, insights: false, members: false });
    expect((await h.services.workspace.get())?.features).toEqual(updated.features);
    const entries = await h.services.audit.list(owner, { action: 'workspace.features_updated' });
    expect(entries.entries[0]?.changes).toEqual({
      before: { cycles: false, estimates: false, insights: false, members: false },
      after: updated.features,
    });
    await h.services.workspace.updateFeatures(owner, { cycles: false });
  });

  it('rejects members, read keys, and malformed or empty patches', async () => {
    await expect(h.services.workspace.updateFeatures(member, { cycles: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.services.workspace.updateFeatures(apiActor(owner, 'read'), { cycles: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.services.workspace.updateFeatures(owner, {})).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(h.services.workspace.updateFeatures(owner, { cycles: null })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
