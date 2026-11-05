import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyScheme, type Scheme } from './theme';

// Light, dark, or the phone's own setting (the default). Kept on this phone only.
export type Appearance = 'system' | Scheme;
const KEY = 'dp_appearance_v1';

type AppearanceValue = { appearance: Appearance; scheme: Scheme; setAppearance: (next: Appearance) => void };
const AppearanceContext = createContext<AppearanceValue>({ appearance: 'system', scheme: 'light', setAppearance: () => {} });

export const useAppearance = () => useContext(AppearanceContext);

/**
 * Picks the colour scheme and switches the palette before its children draw. The children are keyed by the scheme, so
 * a change (the rider's choice, or the phone switching to dark at night) draws every screen again in the new colours.
 */
export function AppearanceProvider({ children }: { children: (scheme: Scheme) => ReactNode }) {
  const system = useColorScheme();
  const [appearance, setChoice] = useState<Appearance | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => setChoice(v === 'light' || v === 'dark' ? v : 'system'))
      .catch(() => setChoice('system'));
  }, []);

  const scheme: Scheme = appearance === 'light' || appearance === 'dark' ? appearance : system === 'dark' ? 'dark' : 'light';
  // Before anything below reads a colour.
  applyScheme(scheme);

  const value = useMemo<AppearanceValue>(() => ({
    appearance: appearance ?? 'system',
    scheme,
    setAppearance: (next) => {
      setChoice(next);
      void AsyncStorage.setItem(KEY, next).catch(() => {});
    },
  }), [appearance, scheme]);

  // The saved choice is read first, so the app never flashes the wrong colours (the splash covers this moment).
  if (appearance === null) return null;
  return <AppearanceContext.Provider value={value}>{children(scheme)}</AppearanceContext.Provider>;
}
