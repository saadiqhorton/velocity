import clsx from 'clsx';
import { Icon } from '@velocity/ui';
import type { PaletteColor } from '@/gql/graphql';

/** Team mark: emoji icon if set, else a tinted square with the key's first letter. */
export function TeamIcon({ team, size = 16 }: { team: { key: string; color: PaletteColor; icon?: string | null }; size?: 16 | 20 }) {
  const box = size === 16 ? 'h-4 w-4 text-xs' : 'h-5 w-5 text-sm';
  if (team.icon) {
    return (
      <span aria-hidden="true" className={clsx('inline-flex shrink-0 items-center justify-center leading-none', box)}>
        {team.icon}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-sm font-semibold leading-none', box)}
      style={{ backgroundColor: `var(--ds-status-${team.color}-bg)`, color: `var(--ds-status-${team.color}-text)` }}
    >
      {team.key.slice(0, 1)}
    </span>
  );
}

/** Project mark: emoji icon if set, else the cube glyph in the project color. */
export function ProjectIcon({ project, size = 16 }: { project: { color: PaletteColor; icon?: string | null }; size?: 16 | 20 }) {
  if (project.icon) {
    return (
      <span aria-hidden="true" className={clsx('inline-flex shrink-0 items-center justify-center leading-none', size === 16 ? 'h-4 w-4 text-xs' : 'h-5 w-5 text-sm')}>
        {project.icon}
      </span>
    );
  }
  return <Icon name="project" size={size} style={{ color: `var(--ds-status-${project.color})` }} />;
}

/** Palette swatch dot used for labels and colors. */
export function ColorDot({ color, size = 8 }: { color: PaletteColor | string; size?: 6 | 8 | 10 }) {
  const cls = size === 6 ? 'h-1.5 w-1.5' : size === 8 ? 'h-2 w-2' : 'h-2.5 w-2.5';
  return <span aria-hidden="true" className={clsx('inline-block shrink-0 rounded-full', cls)} style={{ backgroundColor: `var(--ds-status-${color})` }} />;
}
