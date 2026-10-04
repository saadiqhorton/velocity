import { Kbd } from '@velocity/ui';
import { formatBinding, isMacPlatform } from '@/keyboard/engine';
import { m } from '@/i18n';

const MAC = isMacPlatform();

/** Key caps for a binding, platform-aware (⌘ on macOS, Ctrl elsewhere). */
export function ShortcutHint({ binding, className }: { binding: string; className?: string }) {
  const steps = formatBinding(binding, MAC);
  return (
    <span className={className ?? 'inline-flex items-center gap-1'}>
      {steps.map((keys, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 ? <span className="text-sm text-fg-subtlest">{m.shortcuts.then}</span> : null}
          <Kbd keys={keys} />
        </span>
      ))}
    </span>
  );
}
