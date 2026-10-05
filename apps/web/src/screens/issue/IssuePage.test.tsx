import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { m } from '@/i18n';
import { IssuePage } from './IssuePage';

// The issue-detail chunk: the first load fails like a network error, later loads succeed.
const chunk = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@/components/issue-detail/IssueDetail', () => ({
  get IssueDetail() {
    chunk.loads += 1;
    if (chunk.loads === 1) throw new TypeError('Failed to fetch dynamically imported module');
    return ({ id, mode }: { id: string; mode: string }) => (
      <p>
        detail {id} {mode}
      </p>
    );
  },
}));

describe('IssuePage (QA G1)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the inline issue retry when the detail chunk fails, and loads it on Try again', async () => {
    // React and jsdom report the deliberately caught render error; keep the output clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', quiet);
    onTestFinished(() => window.removeEventListener('error', quiet));

    render(
      <MemoryRouter initialEntries={['/issue/ENG-1']}>
        <Routes>
          <Route path="/issue/:id" element={<IssuePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(m.shell.panelLoadError)).toBeTruthy();
    expect(screen.queryByText(m.shell.loadError)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: m.common.retry }));
    expect(await screen.findByText('detail ENG-1 page')).toBeTruthy();
    expect(chunk.loads).toBeGreaterThanOrEqual(2);
  });
});
