import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MarkdownView } from './MarkdownView';

function renderAt(markdown: string) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<MarkdownView markdown={markdown} />} />
        <Route path="/issue/:id" element={<p>Issue page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MarkdownView', () => {
  it('navigates in place when an in-app issue reference is clicked', () => {
    renderAt('Blocked by [ENG-123](/issue/0f3c2a1e-0000-4000-8000-000000000001)');
    fireEvent.click(screen.getByRole('link', { name: 'ENG-123' }));
    expect(screen.getByText('Issue page')).toBeTruthy();
  });

  it('leaves external links to the browser', () => {
    renderAt('[docs](https://example.com/docs)');
    const link = screen.getByRole('link', { name: 'docs' });
    const notCancelled = fireEvent.click(link);
    expect(notCancelled).toBe(true);
    expect(screen.queryByText('Issue page')).toBeNull();
  });
});
