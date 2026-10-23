import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { OptionList, PopupSelect } from '../src';
import type { PopupOption } from '../src';
import { digitQuickSelect } from '../src/components/OptionList';

const numbered: PopupOption[] = [
  { value: 'todo', label: 'Todo', shortcut: '1' },
  { value: 'doing', label: 'Doing', shortcut: '2' },
  { value: 'blocked', label: 'Blocked', shortcut: '3', disabled: true },
  { value: 'done', label: 'Done' },
];

describe('digitQuickSelect', () => {
  it('returns the enabled option bound to a bare digit', () => {
    expect(digitQuickSelect(numbered, { key: '2' })?.value).toBe('doing');
  });

  it('ignores disabled options, unbound digits, non-digits and modified keys', () => {
    expect(digitQuickSelect(numbered, { key: '3' })).toBeUndefined();
    expect(digitQuickSelect(numbered, { key: '9' })).toBeUndefined();
    expect(digitQuickSelect(numbered, { key: 'a' })).toBeUndefined();
    expect(digitQuickSelect(numbered, { key: '1', metaKey: true })).toBeUndefined();
    expect(digitQuickSelect(numbered, { key: '1', altKey: true })).toBeUndefined();
    expect(digitQuickSelect(numbered, { key: '1', ctrlKey: true })).toBeUndefined();
  });
});

describe('OptionList rows', () => {
  function renderList(options: PopupOption[]) {
    render(
      <OptionList
        id="list"
        aria-label="Status"
        options={options}
        selectedValues={[]}
        activeValue={null}
        onActiveChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
  }

  it('renders a digit shortcut in subtle text before the check column', () => {
    renderList(numbered);
    const row = screen.getByRole('option', { name: /Todo/ });
    const digit = within(row).getByText('1');
    expect(digit.className).toContain('text-fg-subtle');
    expect(row.textContent).toBe('Todo1');
  });

  it('uses the pressed fill on enabled rows only', () => {
    renderList(numbered);
    expect(screen.getByRole('option', { name: /Todo/ }).className).toContain('active:bg-pressed');
    const disabled = screen.getByRole('option', { name: /Blocked/ });
    expect(disabled.className).not.toContain('active:bg-pressed');
  });

  it('gives disabled rows one cursor policy: the default cursor, with no pointer or not-allowed class', () => {
    renderList(numbered);
    const disabled = screen.getByRole('option', { name: /Blocked/ });
    expect(disabled.className).toContain('text-fg-disabled');
    expect(disabled.className).not.toContain('cursor-pointer');
    expect(disabled.className).not.toContain('cursor-not-allowed');
    const enabled = screen.getByRole('option', { name: /Todo/ });
    expect(enabled.className).not.toContain('cursor-pointer');
  });
});

describe('PopupSelect digit quick select', () => {
  it('selects the numbered option when the filter is empty', () => {
    const onChange = vi.fn();
    render(<PopupSelect label="Status" options={numbered} onChange={onChange} defaultOpen />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Status' }), { key: '2' });
    expect(onChange).toHaveBeenCalledWith('doing');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('types digits into the filter once it has text', () => {
    const onChange = vi.fn();
    render(<PopupSelect label="Status" options={numbered} onChange={onChange} defaultOpen />);
    const input = screen.getByRole('combobox', { name: 'Status' });
    fireEvent.change(input, { target: { value: 'x2' } });
    fireEvent.keyDown(input, { key: '2' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('does not select a disabled option by its digit', () => {
    const onChange = vi.fn();
    render(<PopupSelect label="Status" options={numbered} onChange={onChange} defaultOpen />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Status' }), { key: '3' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('toggles a numbered option in multi-select and keeps the popup open', () => {
    const onChange = vi.fn();
    render(<PopupSelect label="Status" multiple options={numbered} onChange={onChange} defaultOpen />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Status' }), { key: '1' });
    expect(onChange).toHaveBeenLastCalledWith(['todo']);
    expect(screen.getByRole('listbox')).toBeTruthy();
  });
});
