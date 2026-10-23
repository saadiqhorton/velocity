import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WorkspaceData } from '@/app/workspace';
import { GroupHeader, groupInfo } from './GroupHeader';

// groupInfo('status') only reads statusesById, so a partial workspace is enough.
const ws = {
  statusesById: new Map([
    [
      's-review',
      { __typename: 'WorkflowStatus', id: 's-review', name: 'In review', category: 'in_progress', color: 'yellow', order: 1, description: null, teamId: 't1' },
    ],
  ]),
} as unknown as WorkspaceData;

describe('groupInfo status groups', () => {
  it('shows the status category glyph in the status color, not a plain dot', () => {
    const info = groupInfo('status', 's-review', ws);
    const { container } = render(<>{info.icon}</>);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('data-status')).toBe('in_progress');
    expect(svg?.getAttribute('style')).toContain('var(--ds-status-yellow)');
    expect(container.querySelector('span')).toBeNull();
    expect(info.label).toBe('In review');
  });

  it('falls back to a grey backlog glyph for an unknown status', () => {
    const info = groupInfo('status', null, ws);
    const { container } = render(<>{info.icon}</>);
    expect(container.querySelector('svg')?.getAttribute('data-status')).toBe('backlog');
  });
});

describe('GroupHeader drop target', () => {
  const props = { info: groupInfo('status', null, ws), count: 2, collapsed: false, rowIndex: 0, onToggle: vi.fn() };
  const header = () => screen.getByTestId('group-header');
  const tokens = () => header().className.split(/\s+/);

  it('keeps the raised surface when no row is dragged over it', () => {
    render(<GroupHeader {...props} />);
    expect(tokens()).toContain('bg-raised');
    expect(tokens()).not.toContain('bg-hover');
  });

  it('switches to the hover fill while a dragged row is over it', () => {
    render(<GroupHeader {...props} dropTarget />);
    expect(tokens()).toContain('bg-hover');
    expect(tokens()).not.toContain('bg-raised');
  });
});
