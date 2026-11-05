import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#050B18', card: '#151B2D', border: '#28324A', text: '#F5F7FF', muted: '#A3AEC7', faint: '#6F7B96',
  primary: '#7C5CFF', primaryDark: '#6246D9', green: '#34D399', greenBg: '#123A37', amber: '#F7B84B', amberBg: '#3A2B13',
  red: '#FB7185', redBg: '#3B1D2A', blue: '#60A5FA', blueBg: '#172D4D', muted2: '#202940',
  surfaceRaised: '#1B2338', surfaceSoft: '#11182A', white: '#FFFFFF',
};
export const spacing = (n: number) => n * 4;
export const radius = { sm: 12, md: 16, lg: 20, pill: 999 };

// Premium design system — visual source of truth for redesigned screens.
export const premium = {
  background: '#050B18', surface: '#0D1629', surfaceElevated: '#111D33', surfaceSoft: '#16223A',
  primary: '#FFAA32', primaryDark: '#C97812', purple: '#6C5CE7', purpleSoft: '#8B7CFF',
  success: '#19D88B', danger: '#FF5368', warning: '#FFB340',
  text: '#F7F8FC', textSecondary: '#AAB6CF', textMuted: '#71809D', border: '#23314B', divider: '#26344E',
};
export const premiumRadius = { small: 12, medium: 18, large: 24, xlarge: 30, pill: 999 };
// The app's design system (auth, Home and every redesigned screen), in a light and a dark set. `light` is the palette
// in use: applyScheme() swaps its values, so screens keep importing `light as c` and read the current colours.
export type Scheme = 'light' | 'dark';
const LIGHT = {
  background: '#FFFFFF', surface: '#FFFFFF', ink: '#18181B', onInk: '#FFFFFF',
  text: '#18181B', textLabel: '#3F3F46', textSecondary: '#71717A', placeholder: '#A1A1AA',
  border: '#E4E4E7', divider: '#D4D4D8', link: '#2563EB', accentDot: '#3B82F6', danger: '#DC2626', dangerBg: '#FEF2F2',
  soft: '#F4F4F5', track: '#E4E4E7', success: '#16A34A', successBg: '#F0FDF4', linkBg: '#EFF6FF', warning: '#B45309', warningBg: '#FFFBEB',
};
const DARK: typeof LIGHT = {
  background: '#0B1120', surface: '#141B2D', ink: '#F4F4F5', onInk: '#0B1120',
  text: '#F4F4F5', textLabel: '#D4D4D8', textSecondary: '#A1A1AA', placeholder: '#71717A',
  border: '#263044', divider: '#334155', link: '#60A5FA', accentDot: '#60A5FA', danger: '#F87171', dangerBg: '#3A1418',
  soft: '#1A2235', track: '#2A3449', success: '#4ADE80', successBg: '#0F2A1C', linkBg: '#172A4D', warning: '#FBBF24', warningBg: '#33260C',
};
export const light = { ...LIGHT };

let scheme: Scheme = 'light';
let version = 0;
/** The colour scheme in use now. */
export const currentScheme = () => scheme;
/** The status bar text colour that reads on the current background. */
export const statusBarStyle = (): 'dark' | 'light' => (scheme === 'dark' ? 'light' : 'dark');

/** Switches the palette. Screens drawn before the switch must be drawn again (the app remounts them). */
export function applyScheme(next: Scheme) {
  if (next === scheme) return;
  scheme = next;
  version += 1;
  Object.assign(light, next === 'dark' ? DARK : LIGHT);
}

/**
 * StyleSheet.create for a module-level sheet that uses palette colours: built on first use and built again after the
 * scheme changes, so `s.title` always has the current colours.
 */
export function themed<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(make: () => T & StyleSheet.NamedStyles<any>): T {
  let built = -1;
  let sheet = {} as T;
  return new Proxy({} as T, {
    get(_, key) {
      if (built !== version) { sheet = StyleSheet.create(make()); built = version; }
      return sheet[key as keyof T];
    },
  });
}

export const lightRadius = { field: 14, button: 16, mark: 10 };
export const premiumShadow ={ shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 };
