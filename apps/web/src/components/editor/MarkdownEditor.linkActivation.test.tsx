import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MarkdownEditor from './MarkdownEditor';

vi.mock('@/app/workspace', () => ({ useWorkspace: () => ({ activeUsers: [] }) }));

const ISSUE_HREF = '/issue/0f3c2a1e-0000-4000-8000-000000000001';

function renderEditor(markdown: string) {
  return render(
    <MockedProvider mocks={[]}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MarkdownEditor ariaLabel="Description" value={markdown} />} />
          <Route path="/issue/:id" element={<p>Issue page</p>} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  );
}

function clickLink(link: HTMLElement): void {
  // jsdom has no layout engine or hit testing. ProseMirror calls `elementFromPoint` before invoking
  // the editor's mouseup click handler, so provide the geometry it would receive from a browser.
  const originalRangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => link,
  });
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [{ left: 0, right: 24, top: 0, bottom: 16 }],
  });
  try {
    fireEvent.mouseDown(link, { bubbles: true, cancelable: true, button: 0 });
    fireEvent.mouseUp(link, { bubbles: true, cancelable: true, button: 0 });
  } finally {
    delete (document as unknown as { elementFromPoint?: Document['elementFromPoint'] }).elementFromPoint;
    if (originalRangeRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeRects);
    else delete (Range.prototype as unknown as { getClientRects?: () => DOMRectList }).getClientRects;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MarkdownEditor link activation', () => {
  it('navigates an internal issue link without leaving edit mode', () => {
    renderEditor(`[DEZ-72](${ISSUE_HREF})`);

    clickLink(screen.getByRole('link', { name: 'DEZ-72' }));

    expect(screen.getByText('Issue page')).toBeTruthy();
  });

  it('routes an external link through the safe production opener', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderEditor('[docs](https://example.com/docs?q=1#install)');

    clickLink(screen.getByRole('link', { name: 'docs' }));

    expect(open).toHaveBeenCalledWith(
      'https://example.com/docs?q=1#install',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
