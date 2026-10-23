import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button, IconButton, Icon, SideNav, SideNavGroup, SideNavItem, Tooltip } from '../src';
import { buttonVariantClass } from '../src/components/Button';

function hover(el: HTMLElement) {
  fireEvent.mouseEnter(el);
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

describe('Tooltip shortcut hint', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders a single key cap after the label', () => {
    render(
      <Tooltip content="Create issue" shortcut="C">
        <Button>Target</Button>
      </Tooltip>,
    );
    hover(screen.getByRole('button', { name: 'Target' }));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('Create issueC');
    expect(tip.querySelectorAll('kbd')).toHaveLength(1);
    expect(tip.querySelector('kbd')?.textContent).toBe('C');
  });

  it('renders one key cap per key for a combination', () => {
    render(
      <Tooltip content="Open palette" shortcut={['Ctrl', 'K']}>
        <Button>Target</Button>
      </Tooltip>,
    );
    hover(screen.getByRole('button', { name: 'Target' }));
    const caps = Array.from(screen.getByRole('tooltip').querySelectorAll('kbd')).map((k) => k.textContent);
    expect(caps).toEqual(['Ctrl', 'K']);
  });

  it('renders no key caps without a shortcut', () => {
    render(
      <Tooltip content="Copy link">
        <Button>Target</Button>
      </Tooltip>,
    );
    hover(screen.getByRole('button', { name: 'Target' }));
    expect(screen.getByRole('tooltip').querySelector('kbd')).toBeNull();
  });
});

describe('IconButton and Button forward shortcut to the tooltip', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('IconButton shows its label and the shortcut key cap', () => {
    render(<IconButton label="Filter" shortcut={['F']} icon={<Icon name="filter" />} />);
    hover(screen.getByRole('button', { name: 'Filter' }));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('FilterF');
  });

  it('Button shows tooltip text and the shortcut when tooltip is set', () => {
    render(
      <Button tooltip="New issue" shortcut="C">
        New
      </Button>,
    );
    hover(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByRole('tooltip').textContent).toBe('New issueC');
  });

  it('Button without tooltip renders no tooltip for a shortcut', () => {
    render(<Button shortcut="C">Plain</Button>);
    hover(screen.getByRole('button', { name: 'Plain' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('primary button pressed state', () => {
  it('pressed differs from rest (regression: active:bg-primary matched rest)', () => {
    const classes = buttonVariantClass.primary.split(' ');
    expect(classes).toContain('active:bg-primary-hover');
    expect(classes).not.toContain('active:bg-primary');
    expect(classes).toContain('bg-primary');
  });
});

describe('SideNavGroup actions', () => {
  it('do not toggle the group when clicked', () => {
    const onAction = vi.fn();
    render(
      <SideNav aria-label="Test">
        <SideNavGroup
          variant="item"
          title="Design"
          actions={
            <IconButton label="New issue in Design" icon={<Icon name="add" />} onClick={onAction} />
          }
        >
          <SideNavItem>Active</SideNavItem>
        </SideNavGroup>
      </SideNav>,
    );
    const toggle = screen.getByRole('button', { name: 'Design' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'New issue in Design' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('stay reachable by keyboard (a focusable button, hidden only by opacity)', () => {
    render(
      <SideNav aria-label="Test">
        <SideNavGroup variant="item" title="Design" actions={<IconButton label="Team actions" icon={<Icon name="more" />} />}>
          <SideNavItem>Active</SideNavItem>
        </SideNavGroup>
      </SideNav>,
    );
    const action = screen.getByRole('button', { name: 'Team actions' });
    expect(action.tabIndex).not.toBe(-1);
    action.focus();
    expect(document.activeElement).toBe(action);
    // Container reveals itself on focus-within and on group hover via CSS classes.
    const container = action.parentElement as HTMLElement;
    expect(container.className).toContain('focus-within:opacity-100');
    expect(container.className).toContain('group-hover/navgroup:opacity-100');
    expect(container.className).toContain('pointer-events-none');
  });
});
