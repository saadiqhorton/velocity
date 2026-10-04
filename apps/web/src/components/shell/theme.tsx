import { useCallback, useEffect, useRef } from 'react';
import { UpdateProfileDocument } from '@/gql/graphql';
import type { Theme } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { useTheme } from '@/stores/theme';
import type { ThemePref } from '@/stores/theme';
import { useWorkspace } from '@/app/workspace';
import { m } from '@/i18n';

/** Theme switch: atomic token swap + persisted per user (SPEC §4.5). */
export function useSetTheme(): (pref: ThemePref) => void {
  const { viewer } = useWorkspace();
  const setPref = useTheme((s) => s.setPref);
  const [update] = useOptimisticMutation(UpdateProfileDocument, {
    optimistic: (vars) => ({
      __typename: 'Mutation' as const,
      updateProfile: { ...viewer, theme: (vars.input.theme ?? viewer.theme) as Theme },
    }),
    rollback: () => m.flags.rollback.settings,
  });
  return useCallback(
    (pref: ThemePref) => {
      setPref(pref);
      void update({ input: { theme: pref } });
    },
    [setPref, update],
  );
}

/** On sign-in, adopt the theme saved on the profile (the local copy only bridges first paint). */
export function ThemeSync() {
  const { viewer } = useWorkspace();
  const setPref = useTheme((s) => s.setPref);
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (applied.current === viewer.id) return;
    applied.current = viewer.id;
    if (viewer.theme !== useTheme.getState().pref) setPref(viewer.theme);
  }, [viewer.id, viewer.theme, setPref]);
  return null;
}
