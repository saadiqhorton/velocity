import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Icon } from '@velocity/ui';
import type { PaletteColor } from '@/gql/graphql';
import { ColorDot } from '@/components/common/EntityIcons';
import { m } from '@/i18n';

export const PALETTE: readonly PaletteColor[] = ['blue', 'green', 'red', 'yellow', 'purple', 'teal', 'grey', 'pink'];

/** Radio group of palette swatches (SPEC §4.2.3). */
export function PaletteSwatches({
  value,
  onChange,
  label,
  disabled,
}: {
  value: PaletteColor;
  onChange: (color: PaletteColor) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1">
      {PALETTE.map((c) => {
        const selected = c === value;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={m.settingsWorkspace.colors[c]}
            title={m.settingsWorkspace.colors[c]}
            disabled={disabled}
            onClick={() => onChange(c)}
            className={clsx(
              'inline-flex h-6 w-6 items-center justify-center rounded-full border transition-colors duration-100 disabled:opacity-50',
              selected ? 'border-fg' : 'border-transparent hover:bg-hover',
            )}
          >
            <ColorDot color={c} size={10} />
          </button>
        );
      })}
    </div>
  );
}

/** "Saved" confirmation that fades out after a few seconds. */
export function useSavedFlag(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const flash = () => {
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 3000);
  };
  return [saved, flash];
}

export function SavedMark({ show }: { show: boolean }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex h-8 items-center gap-1 text-sm text-success-fg">
      {show ? (
        <>
          <Icon name="check" />
          {m.settingsWorkspace.saved}
        </>
      ) : null}
    </span>
  );
}

/** Suggest a team key from a name: initials of multi-word names, else the first letters. */
export function suggestKey(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const raw = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '');
  return raw.slice(0, words.length > 1 ? 10 : 3);
}

export const KEY_PATTERN = /^[A-Z0-9]{1,10}$/;

/** Native-select time zone list (IANA). */
export function timeZones(current?: string): string[] {
  const list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const set = new Set(list.length > 0 ? list : ['UTC']);
  if (!set.has('UTC')) set.add('UTC');
  if (current) set.add(current);
  return [...set].sort();
}

/** Client mirror of the server's fractional ordering (services `orderBetween`). */
export function orderBetween(before: number | null, after: number | null): number {
  if (before !== null && after !== null) return (before + after) / 2;
  if (before !== null) return before + 1;
  if (after !== null) return after - 1;
  return 0;
}
