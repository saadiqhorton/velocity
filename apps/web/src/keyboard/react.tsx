import { useEffect, useRef, useSyncExternalStore } from 'react';
import { KeyboardEngine } from './engine';
import type { Command, Region } from './engine';

let currentRegion: Region = 'other';

function regionOf(target: EventTarget | null): Region {
  const el = target instanceof Element ? target.closest('[data-region]') : null;
  const r = el?.getAttribute('data-region');
  return r === 'sidebar' || r === 'list' || r === 'panel' ? r : 'other';
}

/** The app-wide engine instance. */
export const engine = new KeyboardEngine({
  modalOpen: () => document.querySelector('[aria-modal="true"]') !== null,
  region: () => currentRegion,
  ownsKeys: (target) =>
    target instanceof Element && target.closest('[role="listbox"],[role="menu"],[data-own-keys]') !== null,
});

export function activeRegion(): Region {
  return currentRegion;
}

export function setActiveRegion(region: Region): void {
  currentRegion = region;
}

/** Mount once: the single global listener (SPEC §5.4). */
export function KeyboardRoot() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      engine.handle(e);
    };
    const onFocus = (e: FocusEvent) => {
      const r = regionOf(e.target);
      if (r !== 'other') currentRegion = r;
    };
    const onPointer = (e: PointerEvent) => {
      currentRegion = regionOf(e.target);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
  return null;
}

/**
 * Register commands while mounted. `build` runs on every render so closures stay fresh;
 * the registry entry delegates to the latest closure, so re-registration is not needed.
 */
export function useCommands(build: () => Command[], ids?: readonly string[]): void {
  const latest = useRef<Command[]>([]);
  const current = build();
  useEffect(() => {
    latest.current = current;
  });
  const key = (ids ?? current.map((c) => c.id)).join('|');
  useEffect(() => {
    const proxies: Command[] = latest.current.map((c, i) => ({
      ...c,
      when: () => {
        const live = latest.current[i];
        return live ? (live.when?.() ?? true) : false;
      },
      run: () => latest.current[i]?.run(),
    }));
    // Re-register only when the command set (ids) changes; closures are read through `latest`.
    return engine.register(proxies);
  }, [key]);
}

/** Re-render when commands register/unregister or a chord becomes pending. */
export function useEngineVersion(): number {
  return useSyncExternalStore(
    (fn) => engine.subscribe(fn),
    () => engine.getVersion(),
  );
}
