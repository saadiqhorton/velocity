import { adsDark } from './generated/ads-dark';
import type { ThemeTokens } from './types';

/**
 * Dark theme — Linear-parity neutral charcoal (SPEC §4.3, amended). The generated ADS
 * dark values stay the base for roles not overridden here (status accents, subtle tints);
 * neutrals, borders and the brand accent are tuned to a cool near-black stack with one
 * desaturated indigo accent. Contrast is verified in test/contrast.test.ts.
 *
 * Elevation stack (darkest → lightest): app chrome (sunken) → main panel (surface) →
 * cards (raised) → menus (overlay). Hover/pressed/neutral are white alphas so they read
 * the same on every layer.
 */
export const dark: ThemeTokens = {
  color: {
    ...adsDark.color,
    primary: '#5E6AD2',
    'primary-hover': '#6E79DE',
    'primary-subtle': '#5E6AD229',
    'primary-subtle-hover': '#5E6AD23D',
    text: '#E3E4E6',
    'text-subtle': '#9C9DA1',
    'text-subtlest': '#85868A',
    'text-disabled': '#FFFFFF40',
    'text-inverse': '#FFFFFF',
    'text-selected': '#8B93F0',
    link: '#8B93F0',
    surface: '#121213',
    'surface-sunken': '#09090A',
    'surface-raised': '#1A1A1B',
    'surface-overlay': '#1E1E20',
    'surface-hover': '#FFFFFF0D',
    'surface-pressed': '#FFFFFF17',
    border: '#FFFFFF12',
    'border-input': '#FFFFFF24',
    'border-selected': '#5E6AD2',
    focus: '#8B93F0',
    danger: '#DA3633',
    'information-subtle': '#5E6AD229',
    blanket: '#00000099',
    'input-bg': '#FFFFFF08',
    neutral: '#FFFFFF12',
    'neutral-hover': '#FFFFFF1F',
    icon: '#C9CACD',
    'icon-subtle': '#8A8B8F',
  },
  shadow: {
    card: '0px 1px 2px #00000052',
    overlay: '0px 4px 24px #00000066, 0px 1px 2px #00000052',
  },
};
