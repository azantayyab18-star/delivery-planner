// Single place for map provider settings. Switching to MapTiler, Google, etc. later means
// changing this file and components/map/AppMap only - screens never touch the map library.

import type { LatLng } from '../components/map/types';

const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

// Optional key for providers that need one (e.g. MapTiler). OpenFreeMap needs none.
const apiKey = process.env.EXPO_PUBLIC_MAP_API_KEY || undefined;
const rawStyleUrl = process.env.EXPO_PUBLIC_MAP_STYLE_URL || DEFAULT_STYLE_URL;

export const mapConfig = {
  provider: 'openfreemap' as const,
  // A style URL may contain {key}, which is filled in from EXPO_PUBLIC_MAP_API_KEY.
  styleUrl: apiKey ? rawStyleUrl.replace('{key}', apiKey) : rawStyleUrl,
  apiKey,
  // Fallback centre until the rider's position is known: London.
  defaultCenter: { latitude: 51.5074, longitude: -0.1278 } as LatLng,
  defaultZoom: 12,
  followZoom: 16,
  // Shown on the map; required by the OpenFreeMap / OpenStreetMap terms.
  attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
};
