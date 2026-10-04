import { describe, expect, it } from 'vitest';
import { createHarness, executeApi } from './helpers';
import { depthLimitRule } from '../src/validation';

describe('GraphQL query validation limits', () => {
  it('rejects operations deeper than the configured limit, including nested fields', async () => {
    const h = await createHarness();
    try {
      const parentFields = Array.from({ length: 3 }, () => 'parent {').join(' ');
      const closers = Array.from({ length: 3 }, () => '}').join(' ');
      const query = `query { issue(id: "00000000-0000-7000-8000-000000000001") { ${parentFields} id ${closers} } }`;
      const result = await executeApi(h, null, query, {}, [depthLimitRule(3)]);
      expect(result.data).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.extensions.code).toBe('VALIDATION');
      expect(result.errors[0]?.message).toContain('depth');
    } finally {
      await h.close();
    }
  });

  it('rejects large list fanout under the default complexity budget', async () => {
    const h = await createHarness();
    try {
      const result = await executeApi(h, null, `query {
        issues(first: 1000) { nodes { id children { id } } }
      }`);
      expect(result.data).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.extensions.code).toBe('VALIDATION');
      expect(result.errors[0]?.message).toContain('complexity');
    } finally {
      await h.close();
    }
  });

  it('keeps introspection exempt from depth accounting', async () => {
    const h = await createHarness();
    try {
      const result = await executeApi(h, null, '{ __schema { types { name } } }');
      expect(result.errors).toEqual([]);
      expect(result.data?.__schema).toBeDefined();
    } finally {
      await h.close();
    }
  });
});
