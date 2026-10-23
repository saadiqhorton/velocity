import { afterEach, describe, expect, it, vi } from 'vitest';
import { setIssueDragPreview } from './dragPreview';

function fakeDragEvent() {
  const setDragImage = vi.fn();
  return { event: { dataTransfer: { setDragImage } as unknown as DataTransfer }, setDragImage };
}

describe('setIssueDragPreview', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('snapshots the identifier and title, then removes the element on the next tick', () => {
    vi.useFakeTimers();
    const { event, setDragImage } = fakeDragEvent();
    setIssueDragPreview(event, { identifier: 'ENG-12', title: 'Fix the board' }, 1);

    const [el] = [...document.body.children] as HTMLElement[];
    expect(setDragImage).toHaveBeenCalledWith(el, 16, 16);
    expect(el?.textContent).toContain('ENG-12');
    expect(el?.textContent).toContain('Fix the board');

    vi.runOnlyPendingTimers();
    expect(document.body.children).toHaveLength(0);
  });

  it('reads "N issues" for a multi-selection', () => {
    vi.useFakeTimers();
    const { event, setDragImage } = fakeDragEvent();
    setIssueDragPreview(event, { identifier: 'ENG-12', title: 'Fix the board' }, 3);

    const el = document.body.firstElementChild as HTMLElement;
    expect(el.textContent).toBe('3 issues');
    expect(setDragImage).toHaveBeenCalledWith(el, 16, 16);
  });
});
