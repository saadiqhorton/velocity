import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing';
import { MemoryRouter } from 'react-router-dom';
import { FlagProvider } from '@velocity/ui';
import { CommandPalette } from './CommandPalette';

vi.mock('@/app/workspace', async (orig) => ({
  ...(await orig<typeof import('@/app/workspace')>()),
  useWorkspace: () => ({ projects: [], views: [], teams: [], activeUsers: [], teamsById: new Map() }),
}));
vi.mock('@/keyboard/react', () => ({
  engine: { available: () => [], get: () => undefined },
  useEngineVersion: () => 0,
  useCommands: () => undefined,
  activeRegion: () => null,
}));
vi.mock('@/lib/navigation', () => ({ useOpenIssue: () => () => undefined }));

type PaletteState = 'enter' | 'open' | 'exit';

/** The opener (what the palette was launched from) plus the palette in the given presence state. */
function page(state: PaletteState | null) {
  return (
    <>
      <button>opener</button>
      {state ? (
        <FlagProvider>
          <MockedProvider mocks={[]}>
            <MemoryRouter>
              <CommandPalette state={state} />
            </MemoryRouter>
          </MockedProvider>
        </FlagProvider>
      ) : null}
    </>
  );
}

/** Renders the opener, focuses it, then mounts the palette, as a launch does. */
function renderOpened(state: PaletteState) {
  const utils = render(page(null));
  const opener = screen.getByRole('button', { name: 'opener' });
  opener.focus();
  utils.rerender(page(state));
  return { ...utils, opener };
}

describe('CommandPalette motion', () => {
  it('pops in on open and carries no animation once open', () => {
    const { rerender } = renderOpened('enter');
    expect(screen.getByRole('dialog').classList.contains('ds-pop-in')).toBe(true);

    rerender(page('open'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains('ds-pop-in')).toBe(false);
    expect(dialog.classList.contains('ds-pop-out')).toBe(false);
  });

  it('returns focus to the opener as soon as it starts to exit, and hides the exiting palette', () => {
    const { rerender, opener } = renderOpened('open');
    expect(document.activeElement).not.toBe(opener);

    rerender(page('exit'));
    expect(document.activeElement).toBe(opener);
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog.classList.contains('ds-pop-out')).toBe(true);
    expect((dialog.parentElement as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });

  it('does not take focus back from something the user moved to during the exit', () => {
    const { rerender, opener } = renderOpened('open');
    rerender(page('exit'));
    expect(document.activeElement).toBe(opener);
    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    act(() => elsewhere.focus());
    // The exit ends: the palette unmounts (the opener stays).
    rerender(page(null));
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('returns focus on unmount when the palette unmounts without an exit (reduced motion)', () => {
    const { rerender, opener } = renderOpened('open');
    rerender(page(null));
    expect(document.activeElement).toBe(opener);
  });

  it('moves focus out of the exiting input when there is no opener to return to', () => {
    // A palette launched with the page body focused, or a command run from it: nothing to return focus to.
    const { rerender } = render(page(null));
    (document.activeElement as HTMLElement | null)?.blur();
    rerender(page('open'));
    const input = screen.getByRole('combobox');
    expect(document.activeElement).toBe(input);

    rerender(page('exit'));
    expect(document.activeElement).not.toBe(input);
  });

  it('is not modal while it exits, so the keyboard engine still lets Ctrl+K reopen it', () => {
    const { rerender } = renderOpened('open');
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');

    rerender(page('exit'));
    expect(screen.getByRole('dialog', { hidden: true }).getAttribute('aria-modal')).toBeNull();
  });
});
