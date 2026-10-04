import type { StatusColor, StatusColorPair, ThemeName } from './types';

/**
 * Status & label palette (SPEC §4.2.3). `base` is the spec value (dots, bars, icons);
 * `text` is the AA-compliant text color used on the 15% tint (lozenges). In dark the
 * text uses ADS accent text tokens so 11px lozenge text keeps 4.5:1 on its tint (verified in test/contrast.test.ts).
 */
export const statusPalette: Record<ThemeName, Record<StatusColor, StatusColorPair>> = {
  light: {
    blue: { base: '#0C66E4', text: '#0055CC' },
    green: { base: '#1F845A', text: '#216E4E' },
    red: { base: '#CA3521', text: '#AE2E24' },
    yellow: { base: '#DC6803', text: '#A54800' },
    purple: { base: '#5E4DB2', text: '#5E4DB2' },
    teal: { base: '#22A06B', text: '#206A83' },
    grey: { base: '#6B778C', text: '#44546F' },
    pink: { base: '#E2493F', text: '#943D73' },
  },
  dark: {
    blue: { base: '#579DFF', text: '#85B8FF' },
    green: { base: '#57D9A3', text: '#57D9A3' },
    red: { base: '#F87166', text: '#FD9891' },
    yellow: { base: '#E2B203', text: '#E2B203' },
    purple: { base: '#9F8FEF', text: '#B8ACF6' },
    teal: { base: '#6DE3B2', text: '#6DE3B2' },
    grey: { base: '#8C9AB0', text: '#B6C2CF' },
    pink: { base: '#F97A9C', text: '#F97A9C' },
  },
};

/**
 * Categorical chart series colors (insights). Ordered for adjacent-series distinctness;
 * both themes validated for ≥ 3:1 against their surface in test/contrast.test.ts.
 */
export const chartPalette: Record<ThemeName, readonly string[]> = {
  light: ['#0C66E4', '#1F845A', '#DC6803', '#5E4DB2', '#CA3521', '#206A83'],
  dark: ['#579DFF', '#57D9A3', '#E2B203', '#9F8FEF', '#F87166', '#6DE3B2'],
};
