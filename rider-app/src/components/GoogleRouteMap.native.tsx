import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE, UrlTile } from 'react-native-maps';
import { isRunningInExpoGo } from 'expo';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { currentScheme, light as l, premium as c, themed } from '../lib/theme';
import { DARK_MAP_STYLE, schemeMapStyle } from '../lib/mapStyles';
import { visibleStops } from '../lib/mapPins';

export type Coordinates = { latitude: number; longitude: number };
// 'last' is the final open stop and 'current' the stop being driven to (both black on the light map, like the
// designs; on the dark map they look like 'upcoming' and 'next').
export type MapStop = Coordinates & { id: string; label: string; title: string; kind: 'next' | 'current' | 'upcoming' | 'last' | 'done' | 'failed' };
export type GoogleRouteMapProps = {
  stops: MapStop[];
  position: Coordinates | null;
  // Road path through the remaining stops; when empty, straight dashed lines join them instead.
  path: Coordinates[];
  // The remaining stops in visiting order, used for the dashed fallback line.
  order: Coordinates[];
  focus?: Coordinates | null;
  style?: ViewStyle;
  // Pin mode: a fixed pin sits in the middle of the map and the rider moves the map under it.
  pinning?: boolean;
  onCenterChange?: (center: Coordinates) => void;
  // Where pin mode starts when there are no stops yet (e.g. the rider's city).
  initialCenter?: Coordinates | null;
  // Shows only the first `reveal` stops (pins drop in one by one); the camera still frames them all.
  reveal?: number;
  // Navigation: the camera follows the rider, rotated to their direction of travel.
  follow?: boolean;
  heading?: number | null;
  /** The light design_pref look: light map, blue numbered pins, blue route line. */
  light?: boolean;
  /** Draw at most this many stop pins (see visibleStops in lib/mapPins); all when unset. */
  maxStops?: number;
  /**
   * Turn-by-turn mode (with `follow`): closer and tilted like a car's satnav, a thick route line, no fit button. The
   * screen draws its own re-centre button: `onFollowChange(false)` when the rider moves the map, and a new
   * `recenter` value snaps the camera back to them.
   */
  navigation?: boolean;
  onFollowChange?: (following: boolean) => void;
  recenter?: number;
};

const NAV_CAMERA = { zoom: 18, pitch: 55 };
const FOLLOW_CAMERA = { zoom: 17, pitch: 35 };

const EDGE = { top: 60, right: 50, bottom: 60, left: 50 };

// Expo Go is a prebuilt app that ignores this app's Google Maps key, so Google draws no map there. While testing in
// Expo Go the map is drawn from free dark OpenStreetMap tiles (CARTO) instead; app builds use Google Maps with our key.
// The CARTO tiles are for development only: their free use is limited, so release builds never load them.
const IN_EXPO_GO = isRunningInExpoGo();
const DEV_TILES = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
// Android only has Google; iOS falls back to Apple Maps in Expo Go.
const PROVIDER = IN_EXPO_GO && Platform.OS === 'ios' ? PROVIDER_DEFAULT : PROVIDER_GOOGLE;
const MARKER_COLORS: Record<MapStop['kind'], { bg: string; fg: string; border: string }> = {
  next: { bg: c.primary, fg: '#1A1206', border: '#fff' },
  current: { bg: c.primary, fg: '#1A1206', border: '#fff' },
  upcoming: { bg: '#16223A', fg: c.text, border: c.textSecondary },
  last: { bg: '#16223A', fg: c.text, border: c.textSecondary },
  done: { bg: c.success, fg: '#05301E', border: '#fff' },
  failed: { bg: c.danger, fg: '#fff', border: '#fff' },
};
const LIGHT_MARKER_COLORS: Record<MapStop['kind'], { bg: string; fg: string; border: string }> = {
  next: { bg: l.link, fg: '#fff', border: '#fff' },
  current: { bg: l.ink, fg: '#fff', border: '#fff' },
  upcoming: { bg: l.link, fg: '#fff', border: '#fff' },
  last: { bg: l.ink, fg: '#fff', border: '#fff' },
  done: { bg: '#E4E4E7', fg: l.textLabel, border: '#fff' },
  failed: { bg: l.danger, fg: '#fff', border: '#fff' },
};

// Farther than this from every stop, the rider's position is left out of the view and the line (still shown as a dot).
const NEAR_ROUTE_KM = 50;
const kmApart = (a: Coordinates, b: Coordinates) => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

export default function GoogleRouteMap({ stops: allStops, position, path, order, focus, style, pinning, onCenterChange, initialCenter, reveal, follow, heading, light, maxStops, navigation, onFollowChange, recenter }: GoogleRouteMapProps) {
  const camera = navigation ? NAV_CAMERA : FOLLOW_CAMERA;
  const stops = useMemo(() => visibleStops(allStops, maxStops), [allStops, maxStops]);
  const line = light ? l.link : c.primary;
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  // Once the rider pans or zooms, automatic fitting stops until they tap the fit button.
  const userMoved = useRef(false);
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The rider only frames the view and starts the dashed line when they are near the route. Someone far away (a
  // dispatcher, a tester in another country, a route planned the night before at home) would otherwise zoom the map out
  // to a continent and draw a line across it; their blue dot is still drawn.
  const near = !!position && (!allStops.length || allStops.some((st) => kmApart(st, position) <= NEAR_ROUTE_KM));
  const framing = near ? position : null;

  // Every marker (all stops, and the rider when near) in view.
  const fit = (animated: boolean) => {
    const all = [...stops, ...(framing ? [framing] : [])];
    if (all.length > 1) map.current?.fitToCoordinates(all, { edgePadding: EDGE, animated });
    else if (all.length) map.current?.animateCamera({ center: all[0], zoom: 15 }, { duration: animated ? 400 : 0 });
  };

  // After placing a pin, show the whole route again.
  useEffect(() => { if (!pinning) userMoved.current = false; }, [pinning]);

  // Re-fit when the stops or their order change (new route, re-optimised, a stop pinned).
  const fitKey = stops.map((s) => `${s.id}@${s.latitude},${s.longitude}`).join('|');
  useEffect(() => {
    if (!ready || userMoved.current || pinning || follow || (!stops.length && !position)) return;
    fit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey, pinning]);

  // The map grows and shrinks with the list below; fit again once its size settles.
  const onLayout = (_e: LayoutChangeEvent) => {
    if (layoutTimer.current) clearTimeout(layoutTimer.current);
    layoutTimer.current = setTimeout(() => { if (ready && !userMoved.current && !pinning && !follow) fit(true); }, 250);
  };
  useEffect(() => () => { if (layoutTimer.current) clearTimeout(layoutTimer.current); }, []);

  useEffect(() => {
    if (!ready || !focus) return;
    // A stop the rider picked stays in view; resizing the map no longer re-fits it.
    userMoved.current = true;
    map.current?.animateCamera({ center: focus, zoom: 16 }, { duration: 500 });
  }, [ready, focus]);

  // Navigation keeps the rider in view, a little zoomed in, facing the way they travel.
  useEffect(() => {
    if (!ready || !follow || !position || userMoved.current) return;
    map.current?.animateCamera({ center: position, ...camera, heading: heading ?? 0 }, { duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, follow, position, heading]);

  // The screen's re-centre button.
  useEffect(() => {
    if (!ready || recenter == null) return;
    userMoved.current = false;
    onFollowChange?.(true);
    if (position) map.current?.animateCamera({ center: position, ...camera, heading: heading ?? 0 }, { duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenter]);

  const start = framing || stops[0] || position || initialCenter || { latitude: 0, longitude: 0 };
  const shown = reveal == null ? stops : stops.slice(0, reveal);
  const revealing = reveal != null && reveal < stops.length;

  return (
    <View onLayout={onLayout} style={[{ height: 300, overflow: 'hidden', backgroundColor: light && currentScheme() === 'light' ? '#EEF0F3' : c.surface }, style]}>
      <MapView
        ref={map}
        provider={PROVIDER}
        mapType={IN_EXPO_GO && Platform.OS === 'android' ? 'none' : 'standard'}
        userInterfaceStyle={light ? currentScheme() : 'dark'}
        style={{ flex: 1 }}
        initialRegion={{ ...start, latitudeDelta: start === initialCenter ? 0.2 : 0.05, longitudeDelta: start === initialCenter ? 0.2 : 0.05 }}
        customMapStyle={light ? schemeMapStyle() : DARK_MAP_STYLE}
        onMapReady={() => setReady(true)}
        onRegionChangeComplete={(region, details) => {
          if (details?.isGesture) {
            if (!userMoved.current) onFollowChange?.(false);
            userMoved.current = true;
          }
          if (pinning) onCenterChange?.({ latitude: region.latitude, longitude: region.longitude });
        }}
        toolbarEnabled={false}
        showsCompass={false}
        rotateEnabled={!!follow}
        pitchEnabled={!!follow}
      >
        {IN_EXPO_GO && Platform.OS === 'android' ? <UrlTile urlTemplate={DEV_TILES} maximumZ={19} tileSize={256} zIndex={-1} /> : null}

        {revealing ? null : path.length > 1 && navigation ? (
          // A darker edge under the line, so it stands out on any street colour.
          [<Polyline key="edge" coordinates={path} strokeColor="#1E3A8A" strokeWidth={11} zIndex={1} />,
            <Polyline key="line" coordinates={path} strokeColor={line} strokeWidth={7} zIndex={2} />]
        ) : path.length > 1 ? (
          <Polyline coordinates={path} strokeColor={line} strokeWidth={5} />
        ) : order.length > 1 || (framing && order.length) ? (
          <Polyline coordinates={framing ? [framing, ...order] : order} strokeColor={line} strokeWidth={3} lineDashPattern={[10, 8]} />
        ) : null}

        {shown.map((st) => (
          <StopMarker key={st.id} latitude={st.latitude} longitude={st.longitude} title={st.title} kind={st.kind} label={st.label} light={!!light} />
        ))}

        {position ? <PositionMarker latitude={position.latitude} longitude={position.longitude} /> : null}
      </MapView>

      {pinning ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          {/* The pin's tip marks the map centre. */}
          <View style={{ marginBottom: 40, alignItems: 'center' }}>
            <MaterialCommunityIcons name="map-marker" size={44} color={line} />
          </View>
        </View>
      ) : null}

      {navigation ? null : <Pressable onPress={() => { userMoved.current = false; if (follow && position) map.current?.animateCamera({ center: position, ...camera, heading: heading ?? 0 }, { duration: 400 }); else fit(true); }} hitSlop={6} style={light ? s.fitLight : s.fitDark} accessibilityLabel="Show the whole route">
        <MaterialCommunityIcons name="crosshairs-gps" size={19} color={light ? l.ink : c.primary} />
      </Pressable>}
    </View>
  );
}

/**
 * Android draws a custom marker view into a bitmap; `tracksViewChanges` must be on until that is done, and every
 * tracking marker costs a redraw per frame. So each pin tracks only for a moment after its own look changes.
 */
function useBriefTracking(look: string) {
  // The look whose bitmap is drawn; while it differs from the current look, the marker keeps tracking.
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(look), 600);
    return () => clearTimeout(timer);
  }, [look]);
  return settled !== look;
}

const StopMarker = memo(function StopMarker({ latitude, longitude, title, kind, label, light }: {
  latitude: number; longitude: number; title: string; kind: MapStop['kind']; label: string; light: boolean;
}) {
  const col = (light ? LIGHT_MARKER_COLORS : MARKER_COLORS)[kind];
  const big = kind === 'next' || kind === 'current';
  const track = useBriefTracking(`${kind}|${label}|${light}`);
  const coordinate = useMemo(() => ({ latitude, longitude }), [latitude, longitude]);
  return (
    <Marker coordinate={coordinate} title={title} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={track} zIndex={big ? 10 : kind === 'upcoming' || kind === 'last' ? 5 : 1}>
      <View style={{ width: big ? 36 : 28, height: big ? 36 : 28, borderRadius: 18, backgroundColor: col.bg, borderWidth: big ? 3 : 2, borderColor: col.border, alignItems: 'center', justifyContent: 'center' }}>
        {kind === 'done' && !(light && label) ? <Ionicons name="checkmark" size={15} color={col.fg} />
          : kind === 'failed' ? <Ionicons name="close" size={15} color={col.fg} />
            : <Text style={{ color: col.fg, fontWeight: '800', fontSize: big ? 14 : 12 }}>{label}</Text>}
      </View>
    </Marker>
  );
});

const PositionMarker = memo(function PositionMarker({ latitude, longitude }: Coordinates) {
  // Its look never changes, so it only tracks once; moving it does not need tracking.
  const track = useBriefTracking('position');
  const coordinate = useMemo(() => ({ latitude, longitude }), [latitude, longitude]);
  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={track} zIndex={20} title="You are here">
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(61,139,255,0.3)', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#3D8BFF', borderWidth: 2, borderColor: '#fff' }} />
      </View>
    </Marker>
  );
});

const s = themed(() => ({
  fitDark: { position: 'absolute', right: 12, top: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(13,22,41,0.92)', borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  fitLight: { position: 'absolute', right: 16, top: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: l.surface, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
}));
