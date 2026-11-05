import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useIsFocused } from '@react-navigation/native';
import { Screen } from '../components/Kit';
import { type McName } from '../components/Premium';
import { LightButton, LightError } from '../components/LightKit';
import GoogleRouteMap, { type Coordinates, type MapStop } from '../components/GoogleRouteMap';
import { post, ApiRequestError } from '../lib/api';
import { decodePolyline } from '../lib/polyline';
import { formatMinutes, stopCardText, stopLabel, todayKey } from '../lib/format';
import { TEST_LOCATION } from '../lib/location';
import {
  announceAt, distanceText, distanceToPath, instruction, metersBetween, nextStep, OFF_ROUTE_METERS, remaining, spoken, stepPoint, type Step,
} from '../lib/guidance';
import { say, setVoiceMuted, stopSpeaking, voiceMuted } from '../lib/navVoice';
import type { Route } from '../lib/types';
import { useFocusEffect } from '../lib/useFocusEffect';
import { useNav } from '../lib/nav';
import { fetchCurrentRoute } from '../lib/v2api';
import { light as c, themed, statusBarStyle } from '../lib/theme';

type Guidance = { key: string; path: Coordinates[]; km: number; min: number; steps: Step[] };
type Stop = Route['stops'][number];

// Closer than this to the stop counts as arrived.
const ARRIVED_METERS = 40;
// Without a road route (the request failed), try again after moving this far.
const RETRY_METERS = 150;
// Never ask for a new route more often than this while off the route.
const REROUTE_GAP_MS = 8000;
// Google-Maps-like guidance colours: a deep green turn banner with white text, in both light and dark mode.
const BANNER = '#0F6B3A';
const BANNER_DARK = '#0B5530';

const coordsOf = (stop: Stop): Coordinates | null => {
  const { latitude, longitude } = stop.delivery.address;
  return latitude == null || longitude == null ? null : { latitude, longitude };
};
const isOpen = (stop: Stop) => stop.delivery.status === 'pending' || stop.delivery.status === 'in_progress';
const clock = (secondsFromNow: number) => new Date(Date.now() + secondsFromNow * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** The rider's live position and direction of travel while navigation is on screen (the last fix is kept). */
function useLivePosition() {
  const [position, setPosition] = useState<Coordinates | null>(TEST_LOCATION);
  const [heading, setHeading] = useState<number | null>(null);
  const [denied, setDenied] = useState(false);
  const focused = useIsFocused();
  useEffect(() => {
    if (TEST_LOCATION || !focused) return;
    let mounted = true;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!mounted) return;
      if (!permission.granted) { setDenied(true); return; }
      const next = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3, timeInterval: 1000 }, (loc) => {
        setPosition({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        // Heading is only meaningful while moving.
        if (loc.coords.heading != null && loc.coords.heading >= 0 && (loc.coords.speed ?? 0) > 1) setHeading(loc.coords.heading);
      });
      if (mounted) sub = next; else next.remove();
    })().catch(() => { /* the map still shows the stops without GPS */ });
    return () => { mounted = false; sub?.remove(); };
  }, [focused]);
  return { position, heading, denied };
}

/**
 * Full-screen turn-by-turn navigation to each stop in route order, inside the app (like a satnav): the next turn and
 * its distance on a banner, the road line from our own OSRM (re-planned when the rider leaves it), spoken directions
 * from the phone's own voice, and arrival time. `stopId` navigates to that stop instead of the next one in order.
 */
export default function LiveNavigation({ stopId }: { stopId?: string }) {
  const { navigate, resetTo, goBack } = useNav();
  const focused = useIsFocused();
  const { position, heading, denied } = useLivePosition();
  const [route, setRoute] = useState<Route | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  // How far along the current road route the rider is (the next maneuver's index), kept per route and GPS fix.
  const [progress, setProgress] = useState<{ guidance: Guidance | null; position: Coordinates | null; index: number }>({ guidance: null, position: null, index: 1 });
  const [following, setFollowing] = useState(true);
  const [recenter, setRecenter] = useState<number | undefined>(undefined);
  const [muted, setMuted] = useState(voiceMuted());
  const [expanded, setExpanded] = useState(false);
  const request = useRef(0);
  const lastAsked = useRef<{ at: number; from: Coordinates; key: string; pending: boolean } | null>(null);
  const spokenFor = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      setRoute(await fetchCurrentRoute(todayKey()));
      setError('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your route');
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // The screen stays on while navigating; the voice stops when the rider leaves.
  useEffect(() => {
    if (!focused) { stopSpeaking(); return; }
    void activateKeepAwakeAsync('navigation').catch(() => {});
    return () => { deactivateKeepAwake('navigation'); };
  }, [focused]);

  const open = useMemo(() => (route?.stops || []).filter(isOpen), [route]);
  const current = open.find((st) => st.delivery.id === stopId) || open[0] || null;
  const target = current ? coordsOf(current) : null;
  const vehicle = route?.vehicle ?? 'bike';
  const live = guidance && current && guidance.key === current.delivery.id ? guidance : null;

  // A road route from the rider to the stop, from our API (our OSRM): for each new stop, again when the rider leaves the
  // line (at most every few seconds), and, while there is none (the request failed), after moving a little.
  useEffect(() => {
    if (!position || !target || !current) return;
    const asked = lastAsked.current;
    const sameStop = asked?.key === current.delivery.id;
    const due = !live
      ? !sameStop || (!asked.pending && metersBetween(asked.from, position) >= RETRY_METERS)
      : distanceToPath(position, live.path) > OFF_ROUTE_METERS && !asked?.pending && Date.now() - (asked?.at ?? 0) > REROUTE_GAP_MS;
    if (!due) return;
    const id = ++request.current;
    const rerouting = !!live;
    const from = position;
    const stop = current;
    lastAsked.current = { at: Date.now(), from, key: stop.delivery.id, pending: true };
    post<{ path: string | null; distanceKm: number | null; durationMin: number | null; steps: Step[] }>('/v2/navigation/route', { start: from, target, vehicle })
      .then(({ data }) => {
        if (!data.path || id !== request.current) return;
        setGuidance({ key: stop.delivery.id, path: decodePolyline(data.path), km: data.distanceKm ?? 0, min: data.durationMin ?? 0, steps: data.steps });
        spokenFor.current.clear();
        const first = data.steps[1];
        const at = stepPoint(first);
        const intro = rerouting ? 'Rerouting.' : `Heading to stop ${stop.order}, ${stopLabel(stop.delivery)}.`;
        say(`${intro} ${spoken(first, at ? metersBetween(from, at) : undefined)}`);
        spokenFor.current.add(`${stop.delivery.id}|1|early`);
      })
      .catch(() => { /* a straight dashed line and the straight-line distance stay on screen */ })
      .finally(() => { if (lastAsked.current?.at && id === request.current) lastAsked.current = { ...lastAsked.current, pending: false }; });
    // Checked on every GPS fix and when the stop or its route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, current?.delivery.id, live]);
  useEffect(() => () => { request.current = -1; stopSpeaking(); }, []);

  // Turns the rider has reached are left behind as they ride (a new road route starts again at its first turn).
  let stepIndex = progress.guidance === live ? progress.index : 1;
  if (live && position && (progress.guidance !== live || progress.position !== position)) {
    stepIndex = nextStep(live.steps, stepIndex, position);
    setProgress({ guidance: live, position, index: stepIndex });
  }

  const toTarget = position && target ? metersBetween(position, target) : null;
  const arrived = toTarget != null && toTarget <= ARRIVED_METERS;
  const step = live?.steps[stepIndex];
  const left = live && position ? remaining(live.steps, stepIndex, position) : null;
  const turn = arrived ? { text: `Arrived at stop ${current?.order}`, icon: 'flag-checkered' as const } : instruction(step);
  const then = live && left && left.toTurn < 400 ? live.steps[stepIndex + 1] : undefined;

  // The voice: once early ("In 150 metres, turn left…"), once at the turn, and on arrival.
  useEffect(() => {
    if (!live || !left || !current || !step) return;
    const at = announceAt(vehicle);
    const key = (when: string) => `${current.delivery.id}|${stepIndex}|${when}`;
    const sayOnce = (when: string, text: string) => { if (!spokenFor.current.has(key(when))) { spokenFor.current.add(key(when)); say(text); } };
    if (step.maneuver.type === 'arrive') return;
    if (left.toTurn <= at.now) sayOnce('now', spoken(step));
    else if (left.toTurn <= at.early && step.distance >= 0) sayOnce('early', spoken(step, left.toTurn));
  }, [live, left?.toTurn, stepIndex, current, step, vehicle]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (arrived && current) {
      const key = `${current.delivery.id}|arrived`;
      if (!spokenFor.current.has(key)) { spokenFor.current.add(key); say(`You have arrived at stop ${current.order}, ${stopLabel(current.delivery)}.`); }
    }
  }, [arrived, current]);

  // Every stop: done ones grey, the one being ridden to black, the rest blue.
  const mapStops = useMemo<MapStop[]>(() => (route?.stops || []).flatMap((stop) => {
    const at = coordsOf(stop);
    if (!at) return [];
    const kind: MapStop['kind'] = stop.delivery.id === current?.delivery.id ? 'current' : isOpen(stop) ? 'upcoming' : stop.delivery.status === 'failed' ? 'failed' : 'done';
    return [{ ...at, id: stop.delivery.id, label: String(stop.order), title: `${stop.order}. ${stopLabel(stop.delivery)}`, kind }];
  }), [route, current]);

  // Delivered and Failed open the same Proof of delivery / Failed delivery steps as the stop's own screen; finishing
  // the last stop there opens Route complete. Coming back here reloads the route and guides to the next stop.
  const finishStop = (kind: 'proof' | 'fail') => { if (current) { stopSpeaking(); setGuidance(null); navigate('DeliveryDetail', { id: current.delivery.id, step: kind }); } };
  const toggleVoice = () => { const next = !muted; setMuted(next); setVoiceMuted(next); if (!next) say(arrived ? 'Voice on.' : spoken(step, left?.toTurn)); };

  if (loading) return <Screen style={{ backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' }}><StatusBar style={statusBarStyle()} /><ActivityIndicator color={c.ink} /></Screen>;
  if (!route || route.status !== 'active' || !current) {
    // Finished routes have their own summary; otherwise there is nothing to navigate.
    const finished = route && route.status !== 'planned' && !current;
    return (
      <Screen style={{ backgroundColor: c.background, padding: 24, justifyContent: 'center' }}>
        <StatusBar style={statusBarStyle()} />
        <LightError text={error} />
        <View style={{ alignItems: 'center' }}>
          <MaterialCommunityIcons name={finished ? 'flag-checkered' : 'navigation-variant-outline'} size={48} color={c.placeholder} />
          <Text style={{ color: c.text, fontSize: 20, fontWeight: '700', marginTop: 14 }}>{finished ? 'Route complete' : 'No route underway'}</Text>
          <Text style={{ color: c.textSecondary, fontSize: 15, marginTop: 6, textAlign: 'center' }}>
            {finished ? `${route?.name || 'Your route'} is finished. Well done!` : 'Start a route from its map to navigate it here.'}
          </Text>
          {finished && route ? <LightButton title="See summary" onPress={() => resetTo('RouteComplete', { routeId: route.id })} style={{ alignSelf: 'stretch', marginTop: 24 }} /> : null}
        </View>
      </Screen>
    );
  }

  const { title, address } = stopCardText(current.delivery);
  // Time and distance left: along the road when the route is known, else in a straight line.
  const secondsLeft = left ? left.seconds : null;
  const metersLeft = left ? left.meters : toTarget;
  const thenTurn = then ? instruction(then) : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <StatusBar style={statusBarStyle()} />
      <GoogleRouteMap light navigation stops={mapStops} maxStops={25} position={position} path={live?.path ?? []} order={target ? [target] : []}
        follow={!!position} heading={heading} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, height: undefined }}
        onFollowChange={setFollowing} recenter={recenter} />

      {/* The next turn */}
      <View style={s.bannerWrap} pointerEvents="box-none">
        <View style={[s.banner, arrived && { backgroundColor: c.link }]}>
          <MaterialCommunityIcons name={turn.icon as McName} size={44} color="#fff" />
          <View style={{ flex: 1, marginLeft: 14 }}>
            {!arrived && left ? <Text style={s.turnDistance}>{distanceText(left.toTurn)}</Text> : null}
            <Text style={arrived || !left ? s.turnDistance : s.turnText} numberOfLines={2}>{live || arrived ? turn.text : position ? 'Finding the road route…' : 'Waiting for GPS…'}</Text>
          </View>
        </View>
        {thenTurn && !arrived ? (
          <View style={s.then}>
            <Text style={s.thenText}>Then</Text>
            <MaterialCommunityIcons name={thenTurn.icon as McName} size={20} color="#fff" />
          </View>
        ) : null}
        {denied ? <Text style={s.denied}>Allow location access for turn-by-turn directions.</Text> : null}
      </View>

      {/* Map controls on the right */}
      <View style={s.side} pointerEvents="box-none">
        <Pressable onPress={toggleVoice} hitSlop={6} style={s.round} accessibilityLabel={muted ? 'Turn voice on' : 'Mute voice'}>
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={24} color={c.text} />
        </Pressable>
        <Pressable onPress={() => navigate('RoutePreview', { routeId: route.id })} hitSlop={6} style={s.round} accessibilityLabel="All stops">
          <Ionicons name="list" size={24} color={c.text} />
        </Pressable>
      </View>

      {/* Bottom: time, distance and arrival, the stop, and what to do there */}
      <View style={s.sheet}>
        {!following ? (
          <Pressable onPress={() => setRecenter(Date.now())} style={s.recenter} accessibilityLabel="Re-centre">
            <MaterialCommunityIcons name="navigation-variant" size={20} color={c.link} />
            <Text style={{ color: c.link, fontSize: 16, fontWeight: '700' }}>Re-centre</Text>
          </Pressable>
        ) : null}
        <View style={s.etaRow}>
          <Pressable onPress={goBack} hitSlop={10} style={s.exit} accessibilityLabel="Exit navigation">
            <Ionicons name="close" size={26} color={c.text} />
          </Pressable>
          <Pressable onPress={() => setExpanded((v) => !v)} style={{ flex: 1, alignItems: 'center' }} accessibilityLabel={expanded ? 'Hide stop' : 'Show stop'}>
            <Text style={s.eta}>{secondsLeft != null ? formatMinutes(Math.max(1, Math.round(secondsLeft / 60))) : '—'}</Text>
            <Text style={s.etaSub}>
              {metersLeft != null ? `${left ? '' : '~'}${distanceText(metersLeft)}` : ''}{secondsLeft != null ? ` · ${clock(secondsLeft)}` : ''}
            </Text>
          </Pressable>
          <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={10} style={s.exit} accessibilityLabel={expanded ? 'Hide stop' : 'Show stop'}>
            <Ionicons name={expanded ? 'chevron-down' : 'chevron-up'} size={24} color={c.text} />
          </Pressable>
        </View>

        <Pressable onPress={() => navigate('DeliveryDetail', { id: current.delivery.id })} style={s.stopRow} accessibilityLabel="Stop details">
          <View style={s.badge}><Text style={{ color: c.onInk, fontWeight: '800', fontSize: 15 }}>{current.order}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.stopTitle} numberOfLines={1}>{title}</Text>
            {address && (expanded || arrived) ? <Text style={s.stopAddress} numberOfLines={2}>{address}</Text> : null}
          </View>
          <Text style={{ color: c.textSecondary, fontSize: 14 }}>{route.stops.length - open.length + 1}/{route.stops.length}</Text>
        </Pressable>
        {!target ? <Text style={{ color: c.warning, fontSize: 14, marginTop: 6 }}>This stop has no map location. Set a pin for it on the route map.</Text> : null}

        {expanded || arrived ? (
          <>
            <LightError text={error} />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <Pressable onPress={() => finishStop('proof')} style={({ pressed }) => [s.result, s.delivered, pressed && { opacity: 0.88 }]}>
                <Ionicons name="checkmark" size={24} color="#fff" />
                <Text style={[s.resultText, { color: '#fff' }]}>Delivered</Text>
              </Pressable>
              <Pressable onPress={() => finishStop('fail')} style={({ pressed }) => [s.result, s.failed, pressed && { opacity: 0.88 }]}>
                <Ionicons name="close" size={24} color={c.danger} />
                <Text style={[s.resultText, { color: c.danger }]}>Failed</Text>
              </Pressable>
            </View>
            {open.find((st) => st !== current) ? (
              <Text style={{ color: c.textSecondary, fontSize: 14, marginTop: 12 }} numberOfLines={1}>
                Then: {stopLabel(open.find((st) => st !== current)!.delivery)}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

const shadow = { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6 };

const s = themed(() => ({
  bannerWrap: { position: 'absolute', top: 10, left: 12, right: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16, borderRadius: 18, backgroundColor: BANNER, ...shadow },
  turnDistance: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  turnText: { color: '#fff', fontSize: 19, fontWeight: '600', marginTop: 2 },
  then: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: -6, paddingTop: 12, paddingBottom: 8, paddingHorizontal: 16, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, backgroundColor: BANNER_DARK, zIndex: -1 },
  thenText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  denied: { marginTop: 8, color: c.warning, fontSize: 13, textAlign: 'center', backgroundColor: c.warningBg, padding: 8, borderRadius: 12, overflow: 'hidden' },
  side: { position: 'absolute', right: 12, top: 150, gap: 12 },
  round: { width: 50, height: 50, borderRadius: 25, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', ...shadow },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, ...shadow },
  recenter: { position: 'absolute', top: -60, left: 16, flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 18, borderRadius: 23, backgroundColor: c.surface, ...shadow },
  etaRow: { flexDirection: 'row', alignItems: 'center' },
  exit: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' },
  eta: { color: c.success, fontSize: 26, fontWeight: '800' },
  etaSub: { color: c.textSecondary, fontSize: 15, marginTop: 2 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border },
  badge: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' },
  stopTitle: { color: c.text, fontSize: 18, fontWeight: '700' },
  stopAddress: { color: c.textSecondary, fontSize: 15, lineHeight: 20, marginTop: 2 },
  result: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 56, borderRadius: 16 },
  delivered: { backgroundColor: '#15803D' },
  failed: { backgroundColor: c.surface, borderWidth: 2, borderColor: c.danger },
  resultText: { fontSize: 18, fontWeight: '700' },
}));
