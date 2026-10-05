import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DropdownMenu, MenuGroup, MenuItem, SubMenu } from '../src';

function setup(onSelect = vi.fn()) {
  render(
    <DropdownMenu trigger={<button>Actions</button>}>
      <MenuGroup heading="Issue">
        <MenuItem onSelect={onSelect}>Edit</MenuItem>
        <MenuItem>Archive</MenuItem>
        <SubMenu label="Move to">
          <MenuItem>Engineering</MenuItem>
          <MenuItem>Design</MenuItem>
        </SubMenu>
        <MenuItem danger>Delete</MenuItem>
      </MenuGroup>
    </DropdownMenu>,
  );
  const trigger = screen.getByText('Actions');
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return { trigger, onSelect };
}

describe('Menu', () => {
  it('opens with ArrowDown and focuses the first item', () => {
    setup();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));
  });

  it('moves with arrows, Home/End and typeahead', () => {
    setup();
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Archive' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'a' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(menu).toBeTruthy();
  });

  it('activates with Enter, closes, and restores focus', () => {
    const { trigger, onSelect } = setup();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape', () => {
    const { trigger } = setup();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens a submenu with ArrowRight and closes it with ArrowLeft', () => {
    setup();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    const sub = screen.getByRole('menuitem', { name: 'Move to' });
    expect(document.activeElement).toBe(sub);
    expect(sub.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(sub, { key: 'ArrowRight' });
    expect(sub.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menu')).toHaveLength(2);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Engineering' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(document.activeElement).toBe(sub);
  });

  it('marks the current item of a navigation menu with aria-current', () => {
    render(
      <DropdownMenu trigger={<button>Sections</button>}>
        <MenuItem current>Profile</MenuItem>
        <MenuItem>Sessions</MenuItem>
      </DropdownMenu>,
    );
    fireEvent.click(screen.getByText('Sections'));
    expect(screen.getByRole('menuitem', { name: 'Profile' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('menuitem', { name: 'Sessions' }).hasAttribute('aria-current')).toBe(false);
  });
});
