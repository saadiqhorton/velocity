import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, apiActor, createHarness, setupOwner } from '../helpers/harness';
import type { Harness } from '../helpers/harness';
import type { ServiceActor } from '../../src/index';

let h: Harness;
let owner: ServiceActor;
let member: ServiceActor;

beforeAll(async () => {
  h = await createHarness();
  owner = await setupOwner(h);
  member = await addMember(h, owner, 'tools-member');
});
afterAll(async () => h.close());

describe('per-user coding tool preferences', () => {
  it('starts null, persists per user, and never stores preference content in audit changes', async () => {
    expect((await h.services.users.get(owner.userId))?.preferences).toBeNull();
    expect((await h.services.users.get(member.userId))?.preferences).toBeNull();
    const input = {
      codingTools: [{ id: 'custom', name: 'Custom', kind: 'command' as const, template: 'runner {prompt}', enabled: true }],
      promptInstructions: 'Private instructions',
    };
    expect(await h.services.users.updatePreferences(member, input)).toEqual(input);
    expect((await h.services.users.get(member.userId))?.preferences).toEqual(input);
    expect((await h.services.users.get(owner.userId))?.preferences).toBeNull();
    const entries = await h.services.audit.list(owner, { action: 'user.preferences_updated' });
    expect(entries.entries[0]?.changes).toEqual({ codingToolCount: 1 });
    expect(JSON.stringify(entries.entries[0])).not.toContain('Private instructions');
  });

  it('rejects read-scoped keys and malformed templates without changing storage', async () => {
    await expect(h.services.users.updatePreferences(apiActor(member, 'read'), { codingTools: [], promptInstructions: '' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.services.users.updatePreferences(member, {
      codingTools: [{ id: 'bad', name: 'Bad', kind: 'deeplink', template: 'javascript:{prompt}', enabled: true }],
      promptInstructions: '',
    })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await h.services.users.get(member.userId))?.preferences?.promptInstructions).toBe('Private instructions');
  });
});
