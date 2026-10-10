import { useEffect, useRef } from 'react';
import { StyleSheet, Text, TurboModuleRegistry, View, type NativeSyntheticEvent } from 'react-native';
import type { CameraRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import { mapConfig } from '../../config/map';
import { NATIVE_BUILD_HINT } from '../../lib/optionalNative';
import { premium as c } from '../../lib/theme';
import type { AppMapProps } from './types';

// The only file that talks to MapLibre. It is a native module that Expo Go does not ship,
// so it is only loaded when present - the rest of the app keeps working in Expo Go.
export const hasNativeMap = !!TurboModuleRegistry.get('MLRNMapViewModule');

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily so Expo Go doesn't crash on startup
const MapLibre = hasNativeMap ? (require('@maplibre/maplibre-react-native') as typeof import('@maplibre/maplibre-react-native')) : null;

export default function AppMap({ center, zoom, userLocation, followUser = false, onUserPan, children, style }: AppMapProps) {
  const camera = useRef<CameraRef>(null);
  const start = center ?? userLocation ?? mapConfig.defaultCenter;

  useEffect(() => {
    if (!followUser || !userLocation) return;
    camera.current?.easeTo({ center: [userLocation.longitude, userLocation.latitude], zoom: mapConfig.followZoom, duration: 600 });
  }, [followUser, userLocation]);

  if (!MapLibre) {
    return (
      <View style={[s.fill, s.fallback, style]}>
        <Text style={s.fallbackText}>The live map is not available here. {NATIVE_BUILD_HINT}</Text>
      </View>
    );
  }

  const onRegionWillChange = (e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    if (e.nativeEvent.userInteraction) onUserPan?.();
  };

  return (
    <View style={[s.fill, style]}>
      <MapLibre.Map style={s.fill} mapStyle={mapConfig.styleUrl} logo={false} attribution={false} compass={false} onRegionWillChange={onRegionWillChange}>
        <MapLibre.Camera ref={camera} initialViewState={{ center: [start.longitude, start.latitude], zoom: zoom ?? (center || userLocation ? mapConfig.followZoom : mapConfig.defaultZoom) }} />
        {userLocation ? (
          <MapLibre.Marker id="rider-location" lngLat={[userLocation.longitude, userLocation.latitude]} anchor="center">
            <View style={s.me} />
          </MapLibre.Marker>
        ) : null}
        {children}
      </MapLibre.Map>
      <View style={s.attribution} pointerEvents="none">
        <Text style={s.attributionText}>{mapConfig.attribution}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  fallback: { alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: c.surface },
  fallbackText: { color: c.textSecondary, fontSize: 13, textAlign: 'center' },
  me: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#3D8BFF', borderWidth: 3, borderColor: '#fff' },
  attribution: { position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  attributionText: { color: '#333', fontSize: 9 },
});
