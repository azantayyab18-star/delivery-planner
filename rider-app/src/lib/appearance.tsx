import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyScheme, type Scheme } from './theme';
import { applyUnits, type Units } from './units';

// How the app looks: light, dark or as the phone (the default), and distances in km or miles. Kept on this phone.
export type Appearance = 'system' | Scheme;
const KEY = 'dp_appearance_v1';
const UNITS_KEY = 'dp_units_v1';

type AppearanceValue = {
  appearance: Appearance; scheme: Scheme; setAppearance: (next: Appearance) => void;
  units: Units; setUnits: (next: Units) => void;
};
const AppearanceContext = createContext<AppearanceValue>({ appearance: 'system', scheme: 'light', setAppearance: () => {}, units: 'km', setUnits: () => {} });

export const useAppearance = () => useContext(AppearanceContext);

/**
 * Picks the colour scheme and units and applies them before its children draw. The children get a key from both, so a
 * change (the rider's choice, or the phone switching to dark at night) draws every screen again.
 */
export function AppearanceProvider({ children }: { children: (key: string, scheme: Scheme) => ReactNode }) {
  const system = useColorScheme();
  const [appearance, setChoice] = useState<Appearance | null>(null);
  const [units, setUnitsState] = useState<Units>('km');

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(UNITS_KEY)])
      .then(([look, u]) => {
        if (u === 'km' || u === 'mi') setUnitsState(u);
        setChoice(look === 'light' || look === 'dark' ? look : 'system');
      })
      .catch(() => setChoice('system'));
  }, []);

  const scheme: Scheme = appearance === 'light' || appearance === 'dark' ? appearance : system === 'dark' ? 'dark' : 'light';
  // Before anything below reads a colour or formats a distance.
  applyScheme(scheme);
  applyUnits(units);

  const value = useMemo<AppearanceValue>(() => ({
    appearance: appearance ?? 'system',
    scheme,
    setAppearance: (next) => {
      setChoice(next);
      void AsyncStorage.setItem(KEY, next).catch(() => {});
    },
    units,
    setUnits: (next) => {
      setUnitsState(next);
      void AsyncStorage.setItem(UNITS_KEY, next).catch(() => {});
    },
  }), [appearance, scheme, units]);

  // The saved choice is read first, so the app never flashes the wrong colours (the splash covers this moment).
  if (appearance === null) return null;
  return <AppearanceContext.Provider value={value}>{children(`${scheme}-${units}`, scheme)}</AppearanceContext.Provider>;
}
