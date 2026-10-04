import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PopupSelect } from '../src';
import type { PopupOption } from '../src';

const options: PopupOption[] = [
  { value: 'a', label: 'Alpha', group: 'First' },
  { value: 'b', label: 'Bravo', group: 'First' },
  { value: 'c', label: 'Charlie', group: 'Second' },
];

describe('PopupSelect', () => {
  it('opens, filters, and exposes combobox/listbox roles', () => {
    render(<PopupSelect label="Pick" options={options} />);
    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    const input = screen.getByRole('combobox', { name: 'Pick' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.change(input, { target: { value: 'ra' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Bravo']);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No results')).toBeTruthy();
  });

  it('renders groups with headings', () => {
    render(<PopupSelect label="Pick" options={options} defaultOpen />);
    expect(screen.getByRole('group', { name: 'First' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Second' })).toBeTruthy();
  });

  it('selects with arrow keys and Enter, then closes', () => {
    const onChange = vi.fn();
    render(<PopupSelect label="Pick" options={options} onChange={onChange} defaultOpen />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toContain('opt-c');
    fireEvent.keyDown(input, { key: 'Home' });
    fireEvent.keyDown(input, { key: 'End' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape and restores focus to the trigger', () => {
    render(<PopupSelect label="Pick" options={options} />);
    const trigger = screen.getByRole('button', { name: /select/i });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('supports multi-select and keeps the popup open', () => {
    const onChange = vi.fn();
    render(<PopupSelect label="Pick" multiple options={options} onChange={onChange} defaultOpen />);
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: 'Alpha' }));
    fireEvent.click(screen.getByRole('option', { name: 'Charlie' }));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'c']);
    expect(screen.getByRole('option', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(onChange).toHaveBeenLastCalledWith(['c']);
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('can be controlled and anchored programmatically', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [el, setEl] = useState<HTMLElement | null>(null);
      return (
        <>
          <div ref={setEl}>anchor</div>
          <button onClick={() => setOpen(true)}>show</button>
          <PopupSelect label="Status" options={options} open={open} onOpenChange={setOpen} anchorEl={el} />
        </>
      );
    }
    render(<Harness />);
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByText('show'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('offers a create row', () => {
    const onCreate = vi.fn();
    render(<PopupSelect label="Pick" options={options} onCreate={onCreate} defaultOpen />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Delta' } });
    fireEvent.click(screen.getByRole('option', { name: /Create "Delta"/ }));
    expect(onCreate).toHaveBeenCalledWith('Delta');
  });
});
