import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

// Provider-neutral types: screens describe the map with these, never with library types.
export type LatLng = { latitude: number; longitude: number };

export type AppMapProps = {
  /** Where the map opens. Falls back to the configured default centre. */
  center?: LatLng;
  zoom?: number;
  /** Rider position, drawn as a dot. */
  userLocation?: LatLng | null;
  /** While true the camera keeps the rider in view. */
  followUser?: boolean;
  /** Called when the rider drags/zooms the map by hand (so the screen can stop following). */
  onUserPan?: () => void;
  /** Markers, lines and other overlays (added in later steps). */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};
