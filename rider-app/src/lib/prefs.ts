import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Small rider settings kept on this phone (Account → Settings). Read anywhere at once; screens using the hook redraw
// when one changes.
export type Prefs = {
  /** A stop's Directions: our in-app turn-by-turn (once the route is underway), or the Google Maps app. */
  navApp: 'inapp' | 'google';
  /** A short vibration when a barcode or Eircode is read. */
  scanVibrate: boolean;
};
const KEY = 'dp_prefs_v1';
let prefs: Prefs = { navApp: 'inapp', scanVibrate: true };
const listeners = new Set<() => void>();

void AsyncStorage.getItem(KEY).then((raw) => {
  if (!raw) return;
  prefs = { ...prefs, ...(JSON.parse(raw) as Partial<Prefs>) };
  listeners.forEach((l) => l());
}).catch(() => {});

export const getPrefs = () => prefs;

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs = { ...prefs, [key]: value };
  listeners.forEach((l) => l());
  void AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const usePrefs = (): Prefs => useSyncExternalStore(subscribe, getPrefs);
