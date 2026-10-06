import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFilter } from '../../../graphql/src/dsl/index';
import { createHarness, setupOwner } from '../helpers/harness';
import type { Harness } from '../helpers/harness';
import type { ServiceActor } from '../../src/index';
import { findIssueReferences } from '../../src/lib/issue-reference';

let h: Harness;
let owner: ServiceActor;

beforeAll(async () => {
  h = await createHarness();
  owner = await setupOwner(h);
});
afterAll(async () => h.close());

describe('team key history', () => {
  it('resolves an old identifier through lookup, filters, search and another rename', async () => {
    const team = await h.services.teams.create(owner, { key: 'OLD', name: 'Old team' });
    const issue = await h.services.issues.create(owner, { teamId: team.id, title: 'Keep my identifier' });
    const child = await h.services.issues.create(owner, { teamId: team.id, title: 'Child', parentId: issue.id });
    await h.services.teams.update(owner, team.id, { key: 'NEW' });
    expect((await h.services.issues.getByIdentifier(`OLD-${issue.number}`))?.id).toBe(issue.id);
    expect((await h.services.issues.getByIdentifier(`NEW-${issue.number}`))?.id).toBe(issue.id);
    expect((await h.services.teams.getByKey('old'))?.id).toBe(team.id);
    expect(findIssueReferences(`Fixes OLD-${issue.number}`, await h.services.teams.allKeys()))
      .toMatchObject([{ kind: 'identifier', identifier: `OLD-${issue.number}`, closes: true }]);
    expect(await h.services.issues.identifierOf(issue)).toBe(`NEW-${issue.number}`);
    for (const filter of [`identifier:OLD-${issue.number}`, 'team:OLD']) {
      const rows = await h.services.issues.list(owner, { filter: parseFilter(filter) });
      expect(rows.nodes.map((row) => row.id)).toContain(issue.id);
    }
    const children = await h.services.issues.list(owner, { filter: parseFilter(`parent:OLD-${issue.number}`) });
    expect(children.nodes.map((row) => row.id)).toContain(child.id);
    expect((await h.services.search.searchIssueIds(`OLD-${issue.number}`, 10))).toContain(issue.id);
    await h.services.teams.update(owner, team.id, { key: 'LAST' });
    expect((await h.services.issues.getByIdentifier(`OLD-${issue.number}`))?.id).toBe(issue.id);
    expect((await h.services.issues.getByIdentifier(`NEW-${issue.number}`))?.id).toBe(issue.id);
    expect((await h.services.issues.getByIdentifier(`LAST-${issue.number}`))?.id).toBe(issue.id);
  });

  it('never reassigns an old key to another team, even after deletion', async () => {
    const first = await h.services.teams.create(owner, { key: 'KEEP', name: 'Keep' });
    const second = await h.services.teams.create(owner, { key: 'OTHER', name: 'Other' });
    await h.services.teams.update(owner, first.id, { key: 'RENAMED' });
    await expect(h.services.teams.create(owner, { key: 'KEEP', name: 'Collision' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(h.services.teams.update(owner, second.id, { key: 'KEEP' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await h.services.teams.get(second.id))?.key).toBe('OTHER');
    await h.services.teams.update(owner, first.id, { key: 'KEEP' });
    await h.services.teams.delete(owner, first.id, { confirmKey: 'KEEP' });
    await expect(h.services.teams.create(owner, { key: 'KEEP', name: 'After deletion' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('resolves a live key even when its alias row is missing', async () => {
    const team = await h.services.teams.create(owner, { key: 'NOLIVE', name: 'No alias' });
    const issue = await h.services.issues.create(owner, { teamId: team.id, title: 'Resolvable without an alias row' });
    // Simulate a team row inserted outside TeamService.create (restore, manual edit): drop the alias.
    await h.pool.query('delete from team_key_aliases where key = $1', ['NOLIVE']);
    expect((await h.services.issues.getByIdentifier(`NOLIVE-${issue.number}`))?.id).toBe(issue.id);
    expect((await h.services.issues.list(owner, { filter: parseFilter(`identifier:NOLIVE-${issue.number}`) })).nodes.map((r) => r.id)).toContain(issue.id);
    expect((await h.services.issues.list(owner, { filter: parseFilter('team:NOLIVE') })).nodes.map((r) => r.id)).toContain(issue.id);
    expect((await h.services.search.searchIssueIds(`NOLIVE-${issue.number}`, 10))).toContain(issue.id);
  });

  it('backfills existing team keys when migration 0006 runs', async () => {
    const legacy = await createHarness();
    try {
      const actor = await setupOwner(legacy, 'alias-legacy-owner');
      const team = await legacy.services.teams.create(actor, { key: 'LEGACY', name: 'Legacy' });
      await legacy.pool.query('drop table team_key_aliases');
      const migration = readFileSync(new URL('../../../schema/migrations/0006_steep_maggott.sql', import.meta.url), 'utf8');
      await legacy.pool.query(migration);
      const result = await legacy.pool.query<{ team_id: string }>("select team_id from team_key_aliases where key = 'LEGACY'");
      expect(result.rows[0]?.team_id).toBe(team.id);
    } finally {
      await legacy.close();
    }
  });
});
