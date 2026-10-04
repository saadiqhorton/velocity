import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '../src';

function Harness({ isDirty = false, onSubmit }: { isDirty?: boolean; onSubmit?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit thing"
        isDirty={isDirty}
        onSubmit={onSubmit}
        footer={<button>Save</button>}
      >
        <input aria-label="Name" />
        <textarea aria-label="Notes" />
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('labels the dialog and focuses inside', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));
    const dialog = screen.getByRole('dialog', { name: 'Edit thing' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  it('traps focus with Tab and Shift+Tab', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));
    const save = screen.getByText('Save');
    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it('closes on Escape and returns focus to the opener', () => {
    render(<Harness />);
    const opener = screen.getByText('open');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('asks to confirm when dirty', () => {
    render(<Harness isDirty />);
    fireEvent.click(screen.getByText('open'));
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Edit thing' })).toBeTruthy();
    fireEvent.click(screen.getByText('Keep editing'));
    expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Edit thing' })).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    fireEvent.click(screen.getByText('Discard'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('submits on Enter except in textareas', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('open'));
    fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
