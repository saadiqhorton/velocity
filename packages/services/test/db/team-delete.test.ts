import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/index';
import { createHarness, setupOwner } from '../helpers/harness';
import type { Harness } from '../helpers/harness';
import type { ServiceActor } from '../../src/index';

let h: Harness;
let owner: ServiceActor;

beforeAll(async () => {
  h = await createHarness();
  owner = await setupOwner(h);
});
afterAll(async () => h.close());

describe('team deletion', () => {
  it('leaves no issues moved when the move fails partway through', async () => {
    const source = await h.services.teams.create(owner, { key: 'SRC', name: 'Source' });
    const target = await h.services.teams.create(owner, { key: 'DST', name: 'Destination' });
    // 201 issues: the move runs in 200-issue chunks, so chunk two starts after chunk one would have
    // committed in the old per-chunk implementation.
    const db = createDb(h.pool);
    await db.transaction(async (tx) => {
      for (let i = 0; i < 201; i += 1) await h.services.issues.createInTx(tx, owner, { teamId: source.id, title: `Issue ${i}` });
    });

    const issues = h.services.issues as unknown as { moveInTx: (...args: unknown[]) => Promise<void> };
    const real = issues.moveInTx.bind(h.services.issues);
    let calls = 0;
    issues.moveInTx = (...args: unknown[]) => {
      calls += 1;
      if (calls === 201) return Promise.reject(new Error('simulated failure mid-move'));
      return real(...args);
    };
    try {
      await expect(h.services.teams.delete(owner, source.id, { moveIssuesToTeamId: target.id, confirmKey: 'SRC' })).rejects.toThrow('simulated failure');
    } finally {
      issues.moveInTx = real;
    }

    const moved = await h.pool.query<{ n: number }>('select count(*)::int as n from issues where team_id = $1', [target.id]);
    const remaining = await h.pool.query<{ n: number }>('select count(*)::int as n from issues where team_id = $1', [source.id]);
    const team = await h.pool.query<{ deleted_at: Date | null }>('select deleted_at from teams where id = $1', [source.id]);
    expect(moved.rows[0]?.n).toBe(0);
    expect(remaining.rows[0]?.n).toBe(201);
    expect(team.rows[0]?.deleted_at).toBeNull();
  }, 120_000);

  it('moves the issues and deletes the team in one go', async () => {
    const source = await h.services.teams.create(owner, { key: 'MOV', name: 'Move me' });
    const target = await h.services.teams.create(owner, { key: 'INTO', name: 'Into' });
    for (let i = 0; i < 3; i += 1) await h.services.issues.create(owner, { teamId: source.id, title: `Movable ${i}` });

    await h.services.teams.delete(owner, source.id, { moveIssuesToTeamId: target.id, confirmKey: 'MOV' });

    const moved = await h.pool.query<{ n: number }>('select count(*)::int as n from issues where team_id = $1', [target.id]);
    const team = await h.pool.query<{ deleted_at: Date | null }>('select deleted_at from teams where id = $1', [source.id]);
    expect(moved.rows[0]?.n).toBe(3);
    expect(team.rows[0]?.deleted_at).toBeInstanceOf(Date);
  }, 120_000);
});
