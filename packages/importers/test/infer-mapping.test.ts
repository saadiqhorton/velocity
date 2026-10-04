import { describe, expect, it } from 'vitest';
import type { ImportBundle, ImportWorkspaceSnapshot, StatusCategory } from '@velocity/schema';
import {
  BundleValidationError,
  inferStatusCategory,
  mapJiraPriority,
  mapLinearApiPriority,
  mapLinearCsvPriority,
  suggestMapping,
  suggestTeamKey,
  validateBundle,
} from '../src';

describe('inferStatusCategory', () => {
  const table: [string, StatusCategory | null][] = [
    ['Backlog', 'backlog'], ['Icebox', 'backlog'], ['Triage', 'backlog'],
    ['Todo', 'todo'], ['To Do', 'todo'], ['Open', 'todo'], ['New', 'todo'], ['Selected for Development', 'todo'],
    ['Ready', 'todo'], ['Unstarted', 'todo'], ['Not started', 'todo'],
    ['In Progress', 'in_progress'], ['Doing', 'in_progress'], ['Started', 'in_progress'], ['In Review', 'in_progress'],
    ['Review', 'in_progress'], ['QA', 'in_progress'], ['Testing', 'in_progress'], ['Blocked', 'in_progress'],
    ['Done', 'done'], ['Closed', 'done'], ['Resolved', 'done'], ['Complete', 'done'], ['Completed', 'done'],
    ['Shipped', 'done'], ['Released', 'done'], ['Merged', 'done'],
    ['Canceled', 'canceled'], ['Cancelled', 'canceled'], ["Won't Do", 'canceled'], ['Wontfix', 'canceled'],
    ['Duplicate', 'canceled'], ['Invalid', 'canceled'], ['Rejected', 'canceled'],
    ['Waiting on legal', null], ['', null], ['Zzz', null],
  ];
  it.each(table)('%s -> %s', (name, cat) => {
    expect(inferStatusCategory(name)).toBe(cat);
  });
});

describe('priority mappers', () => {
  it('maps each source', () => {
    expect([0, 1, 2, 3, 4].map(mapLinearApiPriority)).toEqual([4, 0, 1, 2, 3]);
    expect(mapLinearApiPriority(9)).toBeNull();
    expect(['Urgent', 'High', 'Medium', 'Low', 'No priority', ''].map(mapLinearCsvPriority)).toEqual([0, 1, 2, 3, 4, 4]);
    expect(mapLinearCsvPriority('weird')).toBeNull();
    expect(['Highest', 'High', 'Medium', 'Low', 'Lowest', ''].map(mapJiraPriority)).toEqual([0, 1, 2, 3, 3, 4]);
  });
});

describe('suggestTeamKey', () => {
  it('derives and de-collides keys', () => {
    expect(suggestTeamKey('Engineering', new Set())).toBe('ENG');
    expect(suggestTeamKey('Open Source Linear', new Set())).toBe('OSL');
    expect(suggestTeamKey('Engineering', new Set(['ENG']))).toBe('ENG2');
    expect(suggestTeamKey('Engineering', new Set(['ENG', 'ENG2']))).toBe('ENG3');
    expect(suggestTeamKey('123', new Set())).toMatch(/^[A-Z][A-Z0-9]{0,9}$/);
    expect(suggestTeamKey('日本語', new Set())).toBe('TEAM');
  });
});

const ws: ImportWorkspaceSnapshot = {
  teams: [
    { id: 'T1', key: 'ENG', name: 'Engineering', statuses: [{ id: 'S1', name: 'Todo', category: 'todo' }, { id: 'S2', name: 'Done', category: 'done' }] },
    { id: 'T2', key: 'OPS', name: 'Operations', statuses: [] },
  ],
  users: [
    { id: 'U1', username: 'alice', name: 'Alice Chen', email: 'Alice@Example.com' },
    { id: 'U2', username: 'bobby', name: 'Bob Martin', email: null },
    { id: 'U3', username: 'carol', name: 'Carol D', email: 'carol@example.com' },
  ],
  labels: [],
};

function bundle(partial: Partial<ImportBundle> = {}): ImportBundle {
  return { source: 'linear', teams: [], statuses: [], users: [], labels: [], projects: [], cycles: [], issues: [], warnings: [], ...partial };
}

describe('suggestMapping', () => {
  it('maps teams by key, name, and creates with non-colliding keys', () => {
    const m = suggestMapping(
      bundle({
        teams: [
          { externalId: 'a', key: 'eng', name: 'Whatever' },
          { externalId: 'b', key: 'XXX', name: 'operations' },
          { externalId: 'c', key: 'OPS', name: 'Clash' },
          { externalId: 'd', key: 'NEW', name: 'New Team' },
          { externalId: 'e', key: 'NEW', name: 'Newer' },
        ],
      }),
      ws,
    );
    expect(m.teams.a).toEqual({ mode: 'existing', teamId: 'T1' });
    expect(m.teams.b).toEqual({ mode: 'existing', teamId: 'T2' });
    expect(m.teams.c).toEqual({ mode: 'existing', teamId: 'T2' });
    expect(m.teams.d).toEqual({ mode: 'create', key: 'NEW', name: 'New Team' });
    const e = m.teams.e;
    expect(e?.mode === 'create' && e.key !== 'NEW' && e.key !== 'ENG' && e.key !== 'OPS').toBe(true);
  });

  it('avoids workspace key collisions when creating', () => {
    const m = suggestMapping(bundle({ teams: [{ externalId: 'x', key: 'ENG', name: 'Other thing' }] }), { ...ws, teams: [{ ...ws.teams[0]!, name: 'Renamed' }] });
    expect(m.teams.x).toEqual({ mode: 'existing', teamId: 'T1' });
    const m2 = suggestMapping(bundle({ teams: [{ externalId: 'x', key: 'OPS', name: 'Other thing' }] }), { ...ws, teams: [{ ...ws.teams[0]!, key: 'OPS' }] });
    expect(m2.teams.x).toEqual({ mode: 'existing', teamId: 'T1' });
  });

  it('maps statuses to existing or creates with inferred/default category', () => {
    const m = suggestMapping(
      bundle({
        teams: [{ externalId: 'a', key: 'ENG', name: 'Engineering' }, { externalId: 'n', key: 'NEW', name: 'Brand new' }],
        statuses: [
          { teamExternalId: 'a', name: 'todo', category: 'todo' },
          { teamExternalId: 'a', name: 'In Review', category: 'in_progress' },
          { teamExternalId: 'a', name: 'Mystery', category: null },
          { teamExternalId: 'n', name: 'Todo', category: 'todo' },
        ],
      }),
      ws,
    );
    expect(m.statuses['a::todo']).toEqual({ mode: 'existing', statusId: 'S1' });
    expect(m.statuses['a::In Review']).toEqual({ mode: 'create', name: 'In Review', category: 'in_progress' });
    expect(m.statuses['a::Mystery']).toEqual({ mode: 'create', name: 'Mystery', category: 'todo' });
    expect(m.statuses['n::Todo']).toMatchObject({ mode: 'create' });
  });

  it('matches users by email, then username, then name', () => {
    const m = suggestMapping(
      bundle({
        users: [
          { externalId: '1', name: 'Zed', email: 'alice@example.com' },
          { externalId: '2', name: 'Zed', username: 'BOBBY' },
          { externalId: '3', name: 'carol d' },
          { externalId: '4', name: 'Nobody', email: 'x@y.z' },
          { externalId: '5', name: 'Alice Chen', email: 'wrong@x.com', username: 'carol' },
        ],
        issues: [
          {
            externalId: 'E-1', teamExternalId: 'a', title: 't', statusName: 's', labelNames: [], relations: [], attachments: [],
            comments: [{ bodyMd: 'x', authorExternalId: 'ghost' }], assigneeExternalId: '4',
          },
        ],
      }),
      ws,
    );
    expect(m.users['1']).toEqual({ userId: 'U1' });
    expect(m.users['2']).toEqual({ userId: 'U2' });
    expect(m.users['3']).toEqual({ userId: 'U3' });
    expect(m.users['4']).toBeNull();
    expect(m.users['5']).toEqual({ userId: 'U3' }); // username beats name
    expect(m.users.ghost).toBeNull();
    expect(m.include).toEqual({ projects: true, cycles: true, comments: true, relations: true, archived: false });
  });
});

describe('validateBundle', () => {
  it('accepts a valid bundle and a parsed fixture-shaped one', () => {
    const b = bundle({
      teams: [{ externalId: 'a', key: 'ENG', name: 'Eng' }],
      issues: [{ externalId: 'ENG-1', teamExternalId: 'a', title: 'T', statusName: 'Todo', labelNames: [], relations: [], comments: [], attachments: [], priority: 2, descriptionMd: null }],
    });
    expect(validateBundle(JSON.parse(JSON.stringify(b)))).toEqual(b);
  });

  it('rejects invalid input', () => {
    expect(() => validateBundle(null)).toThrow(BundleValidationError);
    expect(() => validateBundle({})).toThrow(/source/);
    expect(() => validateBundle(bundle({ source: 'nope' as never }))).toThrow(BundleValidationError);
    expect(() => validateBundle(bundle({ teams: [{ externalId: 'a', key: 'bad key', name: 'x' }] }))).toThrow(/key/);
    expect(() =>
      validateBundle(bundle({ issues: [{ externalId: 'E-1', teamExternalId: 'a', title: '', statusName: 's', labelNames: [], relations: [], comments: [], attachments: [] }] })),
    ).toThrow(/title/);
    expect(() =>
      validateBundle(bundle({ issues: [{ externalId: 'E-1', teamExternalId: 'a', title: 't', statusName: 's', priority: 9 as never, labelNames: [], relations: [], comments: [], attachments: [] }] })),
    ).toThrow(/priority/);
  });
});
