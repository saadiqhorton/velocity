import { ApolloError } from '@apollo/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTransientNetworkError, runInBackground } from './errors';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('isTransientNetworkError', () => {
  it('treats aborted, cancelled and offline requests as transient', () => {
    // WebKit's wording for a fetch cancelled by navigation.
    const cancelled = new TypeError('Fetch API cannot load http://localhost/graphql due to access control checks.');
    expect(isTransientNetworkError(cancelled)).toBe(true);
    expect(isTransientNetworkError(new ApolloError({ networkError: cancelled }))).toBe(true);
    expect(isTransientNetworkError(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isTransientNetworkError({ name: 'AbortError' })).toBe(true);
  });

  it('does not treat GraphQL or programming errors as transient', () => {
    expect(isTransientNetworkError(new ApolloError({ graphQLErrors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] }))).toBe(false);
    expect(isTransientNetworkError(new Error('boom'))).toBe(false);
    expect(isTransientNetworkError(new ApolloError({ networkError: Object.assign(new Error('x'), { statusCode: 401 }) }))).toBe(false);
  });
});

describe('runInBackground', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never leaves an unhandled rejection; drops network errors and logs the rest', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      runInBackground(Promise.reject(new TypeError('Load failed')));
      runInBackground(Promise.reject(new Error('real bug')));
      runInBackground(Promise.resolve(1));
      await flush();
      await flush();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain('real bug');
  });
});
