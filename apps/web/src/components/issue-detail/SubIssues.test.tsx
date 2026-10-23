import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SubIssues } from './SubIssues';
import type { DetailIssue } from './IssueDetail';

const create = vi.hoisted(() => vi.fn());

vi.mock('@/components/issues/actions', () => ({
  useCreateIssue: () => [create, {}],
}));

const parent = { id: 'parent-1', teamId: 'team-1', children: [], subIssueRollup: { done: 0, total: 0 } } as unknown as DetailIssue;

function renderSubIssues(onAddingChange = vi.fn()) {
  render(
    <MemoryRouter>
      <SubIssues issue={parent} adding onAddingChange={onAddingChange} />
    </MemoryRouter>,
  );
  return { onAddingChange, input: screen.getByLabelText('Sub-issue title') as HTMLInputElement };
}

beforeEach(() => create.mockReset());

describe('sub-issue quick add', () => {
  it('creates a sub-issue under the parent on Enter, then clears the field and keeps it open', () => {
    const { onAddingChange, input } = renderSubIssues();
    fireEvent.change(input, { target: { value: '  Write the migration notes ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ title: 'Write the migration notes', parentId: 'parent-1', teamId: 'team-1' });
    expect(input.value).toBe('');
    expect(onAddingChange).not.toHaveBeenCalled();
  });

  it('ignores Enter on a blank title', () => {
    const { input } = renderSubIssues();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(create).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const { onAddingChange, input } = renderSubIssues();
    fireEvent.change(input, { target: { value: 'Half typed' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onAddingChange).toHaveBeenCalledWith(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('closes when it loses focus while empty, but keeps a title in progress', () => {
    const { onAddingChange, input } = renderSubIssues();
    fireEvent.blur(input);
    expect(onAddingChange).toHaveBeenLastCalledWith(false);

    onAddingChange.mockClear();
    fireEvent.change(input, { target: { value: 'Keep me' } });
    fireEvent.blur(input);
    expect(onAddingChange).not.toHaveBeenCalled();
  });

  it('opens from the Add sub-issue button', () => {
    const onAddingChange = vi.fn();
    render(
      <MemoryRouter>
        <SubIssues issue={parent} adding={false} onAddingChange={onAddingChange} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-issue' }));
    expect(onAddingChange).toHaveBeenCalledWith(true);
  });
});
