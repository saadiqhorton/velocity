import { useState } from 'react';
import clsx from 'clsx';
import { STATUS_COLORS } from '@velocity/tokens';

export type AvatarSize = 16 | 20 | 24 | 32;

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}

const sizeClass: Record<AvatarSize, string> = { 16: 'h-4 w-4', 20: 'h-5 w-5', 24: 'h-6 w-6', 32: 'h-8 w-8' };
const fontSize: Record<AvatarSize, number> = { 16: 8, 20: 9, 24: 11, 32: 12 };

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1] ?? '' : '';
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return STATUS_COLORS[h % STATUS_COLORS.length] ?? 'grey';
}

export function Avatar({ name, src, size = 24, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const c = colorFor(name);
  const showImage = Boolean(src) && !failed;
  return (
    <span
      role="img"
      aria-label={name}
      className={clsx('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold', sizeClass[size], className)}
      style={{
        backgroundColor: showImage ? undefined : `var(--ds-status-${c}-bg)`,
        color: `var(--ds-status-${c}-text)`,
        fontSize: fontSize[size],
      }}
    >
      {showImage ? (
        <img src={src ?? undefined} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initialsOf(name)}</span>
      )}
    </span>
  );
}
