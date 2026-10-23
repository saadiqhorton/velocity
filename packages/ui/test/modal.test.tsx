import { useState } from 'react';
import type { ReactNode } from 'react';
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

function HeaderHarness({ isDirty = false, custom = (close: () => void) => <button onClick={close}>Custom close</button> }: { isDirty?: boolean; custom?: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New thing"
        isDirty={isDirty}
        header={custom}
        footer={<button>Save</button>}
      >
        <input aria-label="Name" />
      </Modal>
    </>
  );
}

describe('Modal header slot', () => {
  it('replaces the default title row: the header renders and the default × does not', () => {
    render(<HeaderHarness custom={() => <span>Team chip</span>} />);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByText('Team chip')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('keeps the dialog labelled by the title, now visually hidden', () => {
    render(<HeaderHarness custom={() => <span>Team chip</span>} />);
    fireEvent.click(screen.getByText('open'));
    const dialog = screen.getByRole('dialog', { name: 'New thing' });
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    const heading = screen.getByRole('heading', { name: 'New thing' });
    expect(heading.className).toContain('sr-only');
  });

  it('passes the close action to a header function, which closes through the same path', () => {
    render(<HeaderHarness />);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByRole('button', { name: 'Custom close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks to confirm when a header close is clicked while dirty', () => {
    render(<HeaderHarness isDirty />);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByRole('button', { name: 'Custom close' }));
    expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toBeTruthy();
    fireEvent.click(screen.getByText('Keep editing'));
    expect(screen.getByRole('dialog', { name: 'New thing' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Custom close' }));
    fireEvent.click(screen.getByText('Discard'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('still closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="New thing" header={<span>Team chip</span>}>
        <input aria-label="Name" />
      </Modal>,
    );
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the description under the header, linked to the dialog', () => {
    render(
      <Modal open onClose={() => undefined} title="New thing" description="Details here" header={<span>Team chip</span>}>
        <input aria-label="Name" />
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'New thing' }).getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Details here')).toBeTruthy();
  });
});
