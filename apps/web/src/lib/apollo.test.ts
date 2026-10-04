import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApollo } from './apollo';
import { useConnection } from '@/stores/connection';

describe('createApollo reconnect refetch (SPEC §5.5)', () => {
  afterEach(() => {
    useConnection.setState({ status: 'idle', online: true, downSince: null });
    vi.restoreAllMocks();
  });

  it('refetches active queries when the browser comes back online, even if the socket never dropped', async () => {
    useConnection.setState({ status: 'connected', online: true, downSince: null });
    const { client, ws } = createApollo({ onUnauthenticated: () => undefined });
    const refetch = vi.spyOn(client, 'refetchQueries').mockReturnValue(Promise.resolve([]) as never);

    useConnection.getState().setOnline(false);
    expect(refetch).not.toHaveBeenCalled();
    useConnection.getState().setOnline(true);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith({ include: 'active' });

    // Staying online (or repeated online events) does not refetch again.
    useConnection.getState().setOnline(true);
    expect(refetch).toHaveBeenCalledTimes(1);
    await ws.dispose();
  });
});
