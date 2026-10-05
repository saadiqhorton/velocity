import { Suspense } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { m } from '@/i18n';
import { ChunkBoundary, retryableLazy } from './ChunkBoundary';

function Hello() {
  return <p>editor loaded</p>;
}

describe('ChunkBoundary + retryableLazy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows an inline retry when a chunk fails and loads it again on retry', async () => {
    // React and jsdom report the deliberately caught render error; keep the output clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', quiet);
    onTestFinished(() => window.removeEventListener('error', quiet));
    let attempts = 0;
    const load = vi.fn(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new TypeError('Importing a module script failed.'))
        : Promise.resolve({ default: Hello });
    });
    const lazyHello = retryableLazy(load);
    const Hello2 = lazyHello.Component;
    render(
      <ChunkBoundary onRetry={lazyHello.reset} message={m.shell.editorLoadError}>
        <Suspense fallback={<p>loading</p>}>
          <Hello2 />
        </Suspense>
      </ChunkBoundary>,
    );
    expect(await screen.findByText(m.shell.editorLoadError)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m.common.retry }));
    expect(await screen.findByText('editor loaded')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
