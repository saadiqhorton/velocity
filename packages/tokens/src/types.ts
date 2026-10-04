export const COLOR_ROLES = [
  'primary',
  'primary-hover',
  'primary-subtle',
  'primary-subtle-hover',
  'text',
  'text-subtle',
  'text-subtlest',
  'text-disabled',
  'text-inverse',
  'text-selected',
  'link',
  'surface',
  'surface-sunken',
  'surface-raised',
  'surface-overlay',
  'surface-hover',
  'surface-pressed',
  'border',
  'border-input',
  'border-selected',
  'focus',
  'danger',
  'danger-text',
  'danger-subtle',
  'warning',
  'warning-text',
  'warning-subtle',
  'success',
  'success-text',
  'success-subtle',
  'discovery',
  'discovery-text',
  'discovery-subtle',
  'information-subtle',
  'blanket',
  'input-bg',
  'neutral',
  'neutral-hover',
  'icon',
  'icon-subtle',
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

export interface ThemeTokens {
  color: Record<ColorRole, string> | Record<string, string>;
  shadow: { card: string; overlay: string };
}

export type ThemeName = 'light' | 'dark';

/** Fixed status/label palette names (SPEC §4.2.3). */
export const STATUS_COLORS = ['blue', 'green', 'red', 'yellow', 'purple', 'teal', 'grey', 'pink'] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];

export interface StatusColorPair {
  /** Dot / bar / icon color (SPEC §4.2.3 value). */
  base: string;
  /** Text color on the 15% tint — must meet WCAG AA. */
  text: string;
}
