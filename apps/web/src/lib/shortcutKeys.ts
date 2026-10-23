import { formatBinding, isMacPlatform } from '@/keyboard/engine';
import { engine, useEngineVersion } from '@/keyboard/react';

/**
 * Key caps for a registered command's first binding (`c` → ['C'], `mod+k` → ['Ctrl', 'K'],
 * chords `g s` → ['G', 'S']). Read from the live registry so tooltip hints cannot drift.
 */
export function shortcutKeys(commandId: string): string[] | undefined {
  const binding = engine.get(commandId)?.keys?.[0];
  return binding ? formatBinding(binding, isMacPlatform()).flat() : undefined;
}

/** Hook form: re-renders when commands register, so a hint appears even if its command mounts later. */
export function useShortcutKeys(commandId: string): string[] | undefined {
  useEngineVersion();
  return shortcutKeys(commandId);
}
