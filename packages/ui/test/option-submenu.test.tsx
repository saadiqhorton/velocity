import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DropdownMenu, MenuItem, OptionSubMenu } from '../src';
import type { PopupOption } from '../src';

const people: PopupOption[] = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'bravo', label: 'Bravo' },
  { value: 'charlie', label: 'Charlie' },
];

/** Opens the top-level menu from the keyboard and returns the Assignee trigger (focused). */
function openAssignee(onChange = vi.fn()) {
  render(
    <DropdownMenu trigger={<button>Actions</button>}>
      <OptionSubMenu label="Assignee" options={people} searchable value="bravo" onChange={onChange} />
      <MenuItem>Archive</MenuItem>
    </DropdownMenu>,
  );
  const trigger = screen.getByText('Actions');
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return screen.getByRole('menuitem', { name: 'Assignee' });
}

describe('OptionSubMenu', () => {
  it('opens with ArrowRight, focuses the filter, and marks the current value', () => {
    openAssignee();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    const input = screen.getByRole('combobox', { name: 'Assignee' });
    expect(document.activeElement).toBe(input);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'Bravo' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('false');
  });

  it('filters with the input and applies the choice with Enter, closing the whole menu', () => {
    const onChange = vi.fn();
    openAssignee(onChange);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    const input = screen.getByRole('combobox', { name: 'Assignee' });
    fireEvent.change(input, { target: { value: 'ch' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Charlie']);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('charlie');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and returns focus to its trigger', () => {
    openAssignee();
    const trigger = document.activeElement as HTMLElement;
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Assignee' }), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on ArrowLeft once the filter is empty, but moves the caret while it has text', () => {
    openAssignee();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    const input = screen.getByRole('combobox', { name: 'Assignee' });
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps the menu open and reports the full selection for multiple select', () => {
    const onChange = vi.fn();
    render(
      <DropdownMenu trigger={<button>Actions</button>}>
        <OptionSubMenu label="Labels" options={people} multiple value={['alpha']} onChange={onChange} />
      </DropdownMenu>,
    );
    fireEvent.click(screen.getByText('Actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Labels' }));
    fireEvent.click(screen.getByRole('option', { name: 'Bravo' }));
    expect(onChange).toHaveBeenLastCalledWith(['alpha', 'bravo']);
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Bravo' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(onChange).toHaveBeenLastCalledWith(['bravo']);
    expect(screen.getByRole('option', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('false');
  });

  it('picks a numbered option with its digit when the filter is empty', () => {
    const onChange = vi.fn();
    const numbered: PopupOption[] = [
      { value: 'todo', label: 'Todo', shortcut: '1' },
      { value: 'done', label: 'Done', shortcut: '2' },
    ];
    render(
      <DropdownMenu trigger={<button>Actions</button>}>
        <OptionSubMenu label="Status" options={numbered} value="todo" onChange={onChange} />
      </DropdownMenu>,
    );
    fireEvent.click(screen.getByText('Actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Status' }));
    const list = screen.getByRole('listbox');
    expect(document.activeElement).toBe(list);
    expect(within(screen.getByRole('option', { name: /Done/ })).getByText('2')).toBeTruthy();
    fireEvent.keyDown(list, { key: '2' });
    expect(onChange).toHaveBeenCalledWith('done');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows a trailing shortcut on the trigger', () => {
    render(
      <DropdownMenu trigger={<button>Actions</button>}>
        <OptionSubMenu label="Status" options={people} value={null} onChange={vi.fn()} shortcut={<span>S</span>} />
      </DropdownMenu>,
    );
    fireEvent.click(screen.getByText('Actions'));
    expect(within(screen.getByRole('menuitem', { name: /Status/ })).getByText('S')).toBeTruthy();
  });

  it('does not move focus into the panel when opened by hover', () => {
    openAssignee();
    const trigger = screen.getByRole('menuitem', { name: 'Assignee' });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(document.activeElement).not.toBe(screen.getByRole('combobox', { name: 'Assignee' }));
  });

  it('keeps the trigger on the pressed fill token', () => {
    openAssignee();
    expect(screen.getByRole('menuitem', { name: 'Assignee' }).className).toContain('active:bg-pressed');
  });
});
