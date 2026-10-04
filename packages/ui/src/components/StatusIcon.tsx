import type { StatusColor } from '@velocity/tokens';

export type StatusCategory = 'backlog' | 'todo' | 'in_progress' | 'done' | 'canceled';

const defaultColor: Record<StatusCategory, StatusColor> = {
  backlog: 'grey',
  todo: 'blue',
  in_progress: 'yellow',
  done: 'green',
  canceled: 'grey',
};

export const statusCategoryNames: Record<StatusCategory, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  done: 'Done',
  canceled: 'Canceled',
};

export interface StatusIconProps {
  category: StatusCategory;
  color?: StatusColor;
  size?: 16 | 20 | 24;
  /** Accessible name; defaults to the category name. Pass '' for decorative use. */
  label?: string;
  className?: string;
}

/** Status category glyph drawn with currentColor strokes, tinted by the status palette. */
export function StatusIcon({ category, color, size = 16, label, className }: StatusIconProps) {
  const c = color ?? defaultColor[category];
  const name = label ?? statusCategoryNames[category];
  const cut = 'var(--ds-color-surface)';
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      className={className}
      style={{ color: `var(--ds-status-${c})`, flexShrink: 0 }}
      role={name ? 'img' : undefined}
      aria-label={name || undefined}
      aria-hidden={name ? undefined : true}
      focusable="false"
      data-status={category}
    >
      {category === 'backlog' ? (
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2.5" />
      ) : null}
      {category === 'todo' ? <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" /> : null}
      {category === 'in_progress' ? (
        <>
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </>
      ) : null}
      {category === 'done' ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M5 8.2l2 2 4-4.4" stroke={cut} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
      {category === 'canceled' ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke={cut} strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : null}
    </svg>
  );
}
