import { create } from 'zustand';

export type ThemePref = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'vel.theme';

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  // Dark is the default when the browser gives no signal (SPEC §4.5).
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function readPref(): ThemePref {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    /* storage blocked */
  }
  return 'system';
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref;
}

function apply(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved);
}

interface ThemeState {
  pref: ThemePref;
  resolved: ResolvedTheme;
  /** Local switch; persisting to the profile is the caller's job (updateProfile). */
  setPref: (pref: ThemePref) => void;
}

export const useTheme = create<ThemeState>()((set) => {
  const pref = typeof window === 'undefined' ? 'system' : readPref();
  return {
    pref,
    resolved: typeof window === 'undefined' ? 'dark' : resolveTheme(pref),
    setPref: (next) => {
      const resolved = resolveTheme(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* storage blocked */
      }
      apply(resolved);
      set({ pref: next, resolved });
    },
  };
});

/** Follow OS changes while the preference is "system". */
export function watchSystemTheme(): () => void {
  if (!window.matchMedia) return () => undefined;
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = () => {
    const { pref } = useTheme.getState();
    if (pref === 'system') useTheme.getState().setPref('system');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
