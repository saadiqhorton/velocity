import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Checkbox, IconButton, PriorityIcon, Switch, Icon, Field, TextField } from '../src';
import type { Priority } from '../src';

describe('Checkbox', () => {
  it('supports indeterminate', () => {
    render(<Checkbox label="All" indeterminate />);
    const box = screen.getByLabelText('All') as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box.getAttribute('aria-checked')).toBe('mixed');
  });
});

describe('Switch', () => {
  it('has role switch and toggles', () => {
    const onChange = vi.fn();
    render(<Switch label="Notifications" onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Notifications' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('IconButton', () => {
  it('uses label as aria-label', () => {
    render(<IconButton label="Close panel" icon={<Icon name="close" />} />);
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeTruthy();
  });
  it('requires a label by type', () => {
    // @ts-expect-error label is required
    const element = <IconButton icon={<Icon name="close" />} />;
    expect(element).toBeTruthy();
  });
});

describe('PriorityIcon', () => {
  it('has accessible names', () => {
    const expected: Record<Priority, string> = {
      urgent: 'Urgent priority',
      high: 'High priority',
      medium: 'Medium priority',
      low: 'Low priority',
      none: 'No priority',
    };
    for (const [p, name] of Object.entries(expected)) {
      const { unmount } = render(<PriorityIcon priority={p as Priority} />);
      expect(screen.getByRole('img', { name })).toBeTruthy();
      unmount();
    }
  });
});

describe('Field', () => {
  it('wires label, helper and error', () => {
    render(
      <Field label="Title" helperText="Helper" error="Broken">
        <TextField />
      </Field>,
    );
    const input = screen.getByLabelText('Title');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toHaveLength(2);
    expect(document.getElementById(described[0] ?? '')?.textContent).toBe('Broken');
  });
});
