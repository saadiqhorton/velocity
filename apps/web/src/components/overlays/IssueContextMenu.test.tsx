import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { MenuItem, SubMenu } from '@velocity/ui';
import { useUi } from '@/stores/ui';
import { IssueContextMenu } from './IssueContextMenu';

vi.mock('./IssueMenuItems', () => ({
  IssueMenuItems: ({ issueIds, onAction }: { issueIds: string[]; onAction: () => void }) => (
    <>
      <MenuItem onSelect={onAction}>Edit {issueIds.join(',')}</MenuItem>
      <SubMenu label="Copy"><MenuItem onSelect={onAction}>Copy ID</MenuItem></SubMenu>
    </>
  ),
}));

function open(issueId = 'i1') {
  act(() => useUi.getState().openContextMenu({ issueIds: [issueId], anchor: document.activeElement as HTMLElement }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }));
  useUi.setState({ contextMenu: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useUi.setState({ contextMenu: null });
});

describe('issue context menu dismissal', () => {
  it('keeps the closing menu hidden and out of the pointer path for 120ms', () => {
    render(<IssueContextMenu />);
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit i1' }));

    expect(useUi.getState().contextMenu).toBeNull();
    const menu = screen.getByRole('menu', { hidden: true });
    const surface = menu.closest('[aria-hidden="true"]');
    expect(surface?.classList.contains('pointer-events-none')).toBe(true);
    act(() => vi.advanceTimersByTime(119));
    expect(menu.isConnected).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(menu.isConnected).toBe(false);
  });

  it('returns focus after Escape while the old menu is still exiting', () => {
    render(<><button>Issue row</button><IssueContextMenu /></>);
    const trigger = screen.getByRole('button', { name: 'Issue row' });
    trigger.focus();
    open();
    const item = screen.getByRole('menuitem', { name: 'Edit i1' });
    expect(document.activeElement).toBe(item);

    fireEvent.keyDown(item, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(20));
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('menuitem', { name: 'Edit i1', hidden: true })).toBeTruthy();
  });

  it('opens with fresh contents and keyboard focus when reopened during exit', () => {
    render(<IssueContextMenu />);
    open();
    act(() => useUi.getState().closeContextMenu());
    act(() => vi.advanceTimersByTime(60));
    open('i2');

    expect(screen.queryByRole('menuitem', { name: 'Edit i1', hidden: true })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit i2' }));
    act(() => vi.advanceTimersByTime(120));
    expect(screen.getByRole('menuitem', { name: 'Edit i2' })).toBeTruthy();
  });

  it('closes immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', (media: string) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} }));
    render(<IssueContextMenu />);
    open();
    act(() => useUi.getState().closeContextMenu());
    expect(screen.queryByRole('menu', { hidden: true })).toBeNull();
  });

  it('keeps focus inside the open menu under StrictMode', () => {
    render(<StrictMode><button>Issue row</button><IssueContextMenu /></StrictMode>);
    screen.getByRole('button', { name: 'Issue row' }).focus();
    open();
    act(() => vi.advanceTimersByTime(20));
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit i1' }));
  });

  it('preserves the original focus target across a reopen before the next frame', () => {
    render(<><button>Issue row</button><IssueContextMenu /></>);
    const trigger = screen.getByRole('button', { name: 'Issue row' });
    trigger.focus();
    open();
    act(() => useUi.getState().closeContextMenu());
    open('i2');
    act(() => useUi.getState().closeContextMenu());
    act(() => vi.advanceTimersByTime(20));
    expect(document.activeElement).toBe(trigger);
  });

  it('preserves focus moved to another control by the selected action', () => {
    render(<><button>Issue row</button><button>Next action</button><IssueContextMenu /></>);
    screen.getByRole('button', { name: 'Issue row' }).focus();
    open();
    act(() => useUi.getState().closeContextMenu());
    const next = screen.getByRole('button', { name: 'Next action' });
    next.focus();
    act(() => vi.advanceTimersByTime(20));
    expect(document.activeElement).toBe(next);
  });

  it('returns focus to the latest trigger when two sessions close before the next frame', () => {
    render(<><button>First row</button><button>Second row</button><IssueContextMenu /></>);
    screen.getByRole('button', { name: 'First row' }).focus();
    open();
    act(() => useUi.getState().closeContextMenu());
    const latest = screen.getByRole('button', { name: 'Second row' });
    latest.focus();
    open('i2');
    act(() => useUi.getState().closeContextMenu());
    act(() => vi.advanceTimersByTime(20));
    expect(document.activeElement).toBe(latest);
  });

  it('closes portaled submenus and restores focus when a nested action runs', () => {
    render(<><button>Issue row</button><IssueContextMenu /></>);
    const trigger = screen.getByRole('button', { name: 'Issue row' });
    trigger.focus();
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Copy$/ }));
    const nested = screen.getByRole('menuitem', { name: 'Copy ID' });
    expect(document.activeElement).toBe(nested);
    fireEvent.click(nested);

    expect(screen.queryByRole('menu', { name: 'Copy' })).toBeNull();
    act(() => vi.advanceTimersByTime(20));
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('menu', { hidden: true })).toBeTruthy();
  });
});
