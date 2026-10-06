import { afterAll, describe, expect, it } from 'vitest';
import { createHarness, executeApi, setupOwner } from './helpers';
import type { Harness } from './helpers';

const QUERY = 'query { mcpInfo { httpEnabled httpEndpoint clientPackageUrl serverUrl } }';
const harnesses: Harness[] = [];
afterAll(async () => { await Promise.all(harnesses.map((h) => h.close())); });

describe('mcpInfo', () => {
  it('returns the HTTP endpoint and the versioned client package URL', async () => {
    const h = await createHarness({ appUrl: 'https://v.example.com', mcp: { httpEnabled: true, httpToken: null, clientHash: 'abcdef012345' } });
    harnesses.push(h);
    const owner = await setupOwner(h, 'mcp-info-owner');
    const r = await executeApi(h, owner, QUERY);
    expect(r.errors).toEqual([]);
    expect(r.data?.mcpInfo).toEqual({
      httpEnabled: true,
      httpEndpoint: 'https://v.example.com/mcp',
      clientPackageUrl: 'https://v.example.com/mcp/client-abcdef012345.tgz',
      serverUrl: 'https://v.example.com',
    });
  });

  it('omits the endpoint when HTTP is disabled and the package when none is shipped; needs auth', async () => {
    const h = await createHarness({ mcp: { httpEnabled: false, httpToken: null } });
    harnesses.push(h);
    const owner = await setupOwner(h, 'mcp-info-owner-2');
    const r = await executeApi(h, owner, QUERY);
    expect(r.data?.mcpInfo).toMatchObject({ httpEnabled: false, httpEndpoint: null, clientPackageUrl: null });
    expect((await executeApi(h, null, QUERY)).errors[0]?.extensions.code).toBe('UNAUTHENTICATED');
  });
});
