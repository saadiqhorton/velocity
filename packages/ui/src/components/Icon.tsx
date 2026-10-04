import type { CSSProperties, SVGAttributes } from 'react';
import clsx from 'clsx';
import { iconMap } from '../icons';
import type { IconName } from '../icons';

/** 16 inline, 20 inside buttons, 24 navigation (SPEC §4.7). */
export type IconSize = 16 | 20 | 24;

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, 'viewBox' | 'fill' | 'children'> {
  name: IconName;
  size?: IconSize;
  /** Accessible name. Omit for decorative icons (rendered aria-hidden). */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** Renders a Font Awesome glyph path as an inline SVG using currentColor. */
export function Icon({ name, size = 16, label, className, style, ...rest }: IconProps) {
  const [width, height, , , path] = iconMap[name].icon;
  const paths = Array.isArray(path) ? path : [path];
  return (
    <svg
      {...rest}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={size}
      height={size}
      fill="currentColor"
      className={clsx('shrink-0 inline-block', className)}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-icon={name}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
