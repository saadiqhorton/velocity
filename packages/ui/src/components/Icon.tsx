import type { CSSProperties, SVGAttributes } from 'react';
import clsx from 'clsx';
import { iconMap, solidIconNames } from '../icons';
import type { IconName } from '../icons';

/** 16 inline, 20 inside buttons, 24 navigation (SPEC §4.7). */
export type IconSize = 16 | 20 | 24;

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, 'viewBox' | 'fill' | 'children'> {
  name: IconName;
  size?: IconSize;
  /** Solid fill for state glyphs (e.g. a favorited star). Defaults to the glyph's own state. */
  filled?: boolean;
  /** Accessible name. Omit for decorative icons (rendered aria-hidden). */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders a Lucide stroke glyph using currentColor. The stroke is a fixed 1.5px at every
 * size (absoluteStrokeWidth), so 16px and 24px icons read with the same line weight.
 */
export function Icon({ name, size = 16, filled, label, className, style, ...rest }: IconProps) {
  const Glyph = iconMap[name];
  const solid = filled ?? solidIconNames.has(name);
  return (
    <Glyph
      {...rest}
      size={size}
      absoluteStrokeWidth
      strokeWidth={1.5}
      fill={solid ? 'currentColor' : 'none'}
      className={clsx('shrink-0 inline-block', className)}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-icon={name}
    />
  );
}
