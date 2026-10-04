import type { ThemeTokens } from './types';

/**
 * Light theme — binding values from SPEC §4.2.2 / §4.4 (ADS light reference).
 * Roles not enumerated in the spec use the matching ADS light token values.
 */
export const light: ThemeTokens = {
  color: {
    primary: '#0C66E4',
    'primary-hover': '#0055CC',
    'primary-subtle': '#E9F2FF',
    'primary-subtle-hover': '#CCE0FF',
    text: '#172B4D',
    'text-subtle': '#44546F',
    'text-subtlest': '#626F86',
    'text-disabled': '#091E4247',
    'text-inverse': '#FFFFFF',
    'text-selected': '#0C66E4',
    link: '#0C66E4',
    surface: '#FFFFFF',
    'surface-sunken': '#F7F8F9',
    'surface-raised': '#FFFFFF',
    'surface-overlay': '#FFFFFF',
    'surface-hover': '#091E420F',
    'surface-pressed': '#091E4224',
    border: '#091E4224',
    'border-input': '#8590A2',
    'border-selected': '#0C66E4',
    focus: '#85B8FF',
    danger: '#CA3521',
    'danger-text': '#AE2E24',
    'danger-subtle': '#FFECEB',
    warning: '#DC6803',
    'warning-text': '#A54800',
    'warning-subtle': '#FFF7D6',
    success: '#1F845A',
    'success-text': '#216E4E',
    'success-subtle': '#DCFFF1',
    discovery: '#5E4DB2',
    'discovery-text': '#5E4DB2',
    'discovery-subtle': '#F3F0FF',
    'information-subtle': '#E9F2FF',
    blanket: '#091E427D',
    'input-bg': '#FFFFFF',
    neutral: '#091E420F',
    'neutral-hover': '#091E4224',
    icon: '#44546F',
    'icon-subtle': '#626F86',
  },
  shadow: {
    card: '0px 1px 1px #091E4240, 0px 0px 1px #091E424F',
    overlay: '0px 8px 12px #091E4226, 0px 0px 1px #091E424F',
  },
};
