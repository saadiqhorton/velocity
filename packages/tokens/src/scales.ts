/** Non-color foundations (SPEC §4.2.1, §4.6, §4.8). */

/** ADS spacing scale: 4px base grid. key → px */
export const space = {
  '0': 0,
  '025': 2,
  '050': 4,
  '075': 6,
  '100': 8,
  '150': 12,
  '200': 16,
  '250': 20,
  '300': 24,
  '400': 32,
  '500': 40,
  '600': 48,
  '800': 64,
  '1000': 80,
} as const;

/**
 * Radius: 4px chips/lozenges, 6px controls, 8px cards/panels/dropdowns, 12px modals only.
 * Full = badges/avatars/pill tabs.
 */
export const radius = { '4': '4px', '6': '6px', '8': '8px', '12': '12px', full: '9999px' } as const;

/** UI base is 13px (300); 400 is the 15px emphasis size for view titles and inputs. */
export const fontSize = {
  '100': '11px',
  '200': '12px',
  '300': '13px',
  '400': '15px',
  '500': '18px',
  '600': '20px',
  '700': '24px',
} as const;

export const fontFamily = {
  body: '"Atlassian Sans Variable", "Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  heading:
    '"Atlassian Sans Variable", "Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  ui: '"Atlassian Sans Variable", "Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  code: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
} as const;

export const duration = { '100': '100ms', '150': '150ms', '200': '200ms' } as const;

/**
 * Easing (A2 motion, SPEC §4.8): enters decelerate, exits accelerate, nothing bounces.
 * Emitted as `--ds-ease-{name}`; theme.css exposes them as Tailwind `ease-*` utilities.
 */
export const easing = {
  enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

export const zIndex = { sticky: 100, dropdown: 300, modal: 400, flag: 500, tooltip: 600 } as const;

/** Shell geometry constants (SPEC §4.10.2) — exported so layout tests and CSS agree. */
export const layout = {
  sidebarWidth: 220,
  sidebarWidthCompact: 180,
  panelWidth: 400,
  panelWidthCompact: 360,
  viewHeaderHeight: 44,
  issueRowHeight: 36,
  tableRowHeight: 44,
} as const;
