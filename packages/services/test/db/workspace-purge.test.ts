import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, createHarness, setupOwner } from '../helpers/harness';
import type { Harness } from '../helpers/harness';
import type { ServiceActor } from '../../src/index';

let h: Harness;
let owner: ServiceActor;

beforeAll(async () => {
  h = await createHarness();
  owner = await setupOwner(h);
});
afterAll(async () => h.close());

describe('workspace deletion and purge', () => {
  it('cancels cleanly while the purge is deciding, and then purges nothing', async () => {
    // Marked for deletion well past the 7-day window, so the next purge is due to run.
    await h.pool.query(`update workspace set deletion_requested_at = now() - interval '8 days' where id = 1`);
    const member = await addMember(h, owner, 'cancel-racer');
    const blocker = await h.pool.connect();
    let purgeFinished = false;
    try {
      await blocker.query('begin');
      // Stands in for a cancellation that has started but not committed: it holds the workspace row.
      await blocker.query('select 1 from workspace where id = 1 for update');
      await blocker.query('update workspace set deletion_requested_at = null where id = 1');

      const purging = h.services.maintenance.purgeWorkspaceIfDue().then((purged) => {
        purgeFinished = true;
        return purged;
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      // Without the row lock this already read the due row and truncated the whole workspace.
      expect(purgeFinished).toBe(false);

      await blocker.query('commit');
      await expect(purging).resolves.toBe(false);
      const users = await h.pool.query<{ n: number }>('select count(*)::int as n from users');
      const members = await h.pool.query<{ n: number }>('select id from users where id = $1', [member.userId]);
      expect(users.rows[0]?.n).toBe(2);
      expect(members.rows).toHaveLength(1);
    } finally {
      blocker.release();
    }
  }, 120_000);

  it('purges everything once the retention window has passed', async () => {
    const purge = await createHarness();
    try {
      const purgeOwner = await setupOwner(purge);
      const team = await purge.services.teams.create(purgeOwner, { key: 'GONE', name: 'Gone' });
      await purge.services.issues.create(purgeOwner, { teamId: team.id, title: 'Deleted with the workspace' });
      await purge.pool.query(`update workspace set deletion_requested_at = now() - interval '8 days' where id = 1`);

      await expect(purge.services.maintenance.purgeWorkspaceIfDue()).resolves.toBe(true);
      const issues = await purge.pool.query<{ n: number }>('select count(*)::int as n from issues');
      const workspaces = await purge.pool.query<{ n: number }>('select count(*)::int as n from workspace');
      expect(issues.rows[0]?.n).toBe(0);
      // First run again: nothing left to purge, and no crash on the missing workspace row.
      expect(workspaces.rows[0]?.n).toBe(0);
      await expect(purge.services.maintenance.purgeWorkspaceIfDue()).resolves.toBe(false);
    } finally {
      await purge.close();
    }
  }, 120_000);
});
