import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useUi } from '@/stores/ui';
import { InlineProp } from './InlineProp';

afterEach(() => useUi.setState({ picker: null }));

describe('InlineProp', () => {
  it('opens the property picker anchored to itself without activating the row', () => {
    const onRow = vi.fn();
    render(
      <div role="row" onClick={onRow}>
        <InlineProp kind="priority" issueId="issue-1" label="Priority: High">
          <span>icon</span>
        </InlineProp>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: 'Priority: High' });
    fireEvent.click(trigger);
    expect(onRow).not.toHaveBeenCalled();
    expect(useUi.getState().picker).toEqual({ kind: 'priority', issueIds: ['issue-1'], anchor: trigger });
  });

  it('stays out of the row tab order and announces a listbox popup', () => {
    render(
      <InlineProp kind="assignee" issueId="issue-2" label="Assignee: Unassigned">
        <span>avatar</span>
      </InlineProp>,
    );
    const trigger = screen.getByRole('button', { name: 'Assignee: Unassigned' });
    expect(trigger.getAttribute('tabindex')).toBe('-1');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
  });
});
