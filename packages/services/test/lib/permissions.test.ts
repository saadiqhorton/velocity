import { describe, expect, it } from 'vitest';
import { ACTIONS, assertCan, can, ForbiddenError, PERMISSION_TABLE, type Action, type Actor } from '../../src/lib/permissions';

const OWNER_ONLY: Action[] = [
  'apikey.view_all', 'apikey.revoke_any', 'member.invite', 'member.manage', 'workspace.settings',
  'workspace.integrations', 'workspace.webhooks', 'workspace.import_export', 'workspace.delete', 'audit.view',
];
const MEMBER_OK: Action[] = ['issue.read', 'issue.write', 'team.write', 'project.write', 'cycle.write', 'view.write', 'apikey.manage_own', 'cycle.close_manual'];

function actor(p: Partial<Actor> = {}): Actor {
  return { userId: 'u1', isOwner: false, suspended: false, via: 'session', scope: 'write', ...p };
}

describe('permission table', () => {
  it('covers every action exactly once', () => {
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length);
    expect([...ACTIONS].sort()).toEqual([...OWNER_ONLY, ...MEMBER_OK].sort());
    expect(ACTIONS).toHaveLength(18);
  });
  it('only issue.read is permitted to read-scoped keys', () => {
    for (const a of ACTIONS) expect(PERMISSION_TABLE[a].readScope).toBe(a === 'issue.read');
  });
  it('owner is a superset of member', () => {
    for (const a of ACTIONS) if (PERMISSION_TABLE[a].member) expect(PERMISSION_TABLE[a].owner).toBe(true);
  });
});

describe('can: full truth table', () => {
  const combos: { via: Actor['via']; scope: Actor['scope'] }[] = [
    { via: 'session', scope: 'write' },
    { via: 'api_key', scope: 'read' },
    { via: 'api_key', scope: 'write' },
    { via: 'mcp', scope: 'read' },
    { via: 'mcp', scope: 'write' },
  ];
  for (const isOwner of [true, false])
    for (const suspended of [true, false])
      for (const { via, scope } of combos)
        for (const action of ACTIONS) {
          const expected = !suspended && (scope === 'write' || action === 'issue.read') && (isOwner || !OWNER_ONLY.includes(action));
          it(`${isOwner ? 'owner' : 'member'}${suspended ? ' suspended' : ''} ${via}/${scope} ${action} -> ${expected}`, () => {
            expect(can(actor({ isOwner, suspended, via, scope }), action)).toBe(expected);
          });
        }
  it('unknown actions are denied', () => expect(can(actor({ isOwner: true }), 'nope' as Action)).toBe(false));
});

describe('assertCan', () => {
  it('passes silently when allowed', () => expect(() => assertCan(actor(), 'issue.write')).not.toThrow());
  it('throws ForbiddenError with code', () => {
    try {
      assertCan(actor(), 'workspace.delete');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect(e).toBeInstanceOf(Error);
      expect((e as ForbiddenError).code).toBe('FORBIDDEN');
      expect((e as ForbiddenError).action).toBe('workspace.delete');
    }
  });
  it('denies suspended owner and read key writes', () => {
    expect(() => assertCan(actor({ isOwner: true, suspended: true }), 'issue.read')).toThrow(ForbiddenError);
    expect(() => assertCan(actor({ scope: 'read', via: 'api_key' }), 'issue.write')).toThrow(ForbiddenError);
  });
});
