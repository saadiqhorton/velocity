import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engine } from '@/keyboard/react';
import { makeSetChip } from '@/lib/chips';
import { m } from '@/i18n';
import { FilterBar } from './FilterBar';

vi.mock('@/app/workspace', () => ({
  useWorkspace: () => ({
    viewer: { id: 'u1', name: 'Demo Owner', username: 'demo', avatarUrl: null },
    workspace: null,
    teams: [],
    users: [],
    activeUsers: [],
    labels: [],
    projects: [],
    teamsByKey: new Map(),
  }),
}));

const priorityChip = () => makeSetChip('priority', ['1'])!;

describe('FilterBar', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the labelled "Filter" trigger and no Clear button without chips', () => {
    render(<FilterBar chips={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: m.view.addFilter })).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.common.clear })).toBeNull();
  });

  it('turns the trigger into an icon with an accessible name once chips exist', () => {
    render(<FilterBar chips={[priorityChip()]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: m.view.addFilterLabel })).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.view.addFilter })).toBeNull();
  });

  it('shows the F shortcut in the trigger tooltip', () => {
    render(<FilterBar chips={[priorityChip()]} onChange={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: m.view.addFilterLabel }));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe(`${m.view.addFilterLabel}F`);
  });

  it('F opens the field picker through the registered view.filter command', () => {
    render(<FilterBar chips={[priorityChip()]} onChange={vi.fn()} />);
    act(() => {
      engine.handle({ key: 'f', target: document.body, preventDefault: () => undefined });
    });
    expect(screen.getByRole('listbox', { name: m.view.filterField })).toBeTruthy();
  });

  it('Clear drops every chip at once', () => {
    const onChange = vi.fn();
    render(<FilterBar chips={[priorityChip()]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: m.common.clear }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
