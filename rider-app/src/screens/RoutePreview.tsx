import { memo, useCallback, useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Screen } from '../components/Kit';
import { type McName } from '../components/Premium';
import { LightButton, LightError } from '../components/LightKit';
import StartPointSheet, { type StartPoint } from '../components/StartPointSheet';
import { get, postPlan, ApiRequestError } from '../lib/api';
import { confirmDeleteRoute } from '../lib/routeActions';
import { fetchRoute } from '../lib/v2api';
import { getRouteOrigin } from '../lib/location';
import { dayLabel, formatMinutes, stopCardText } from '../lib/format';
import { STATUS as STOP_STATUS } from './DeliveryDetail';
import { forgetRouteName } from '../lib/routeNames';
import type { Delivery, Route, RoutePreference, Vehicle } from '../lib/types';
import { lastVehicle, rememberVehicle, VEHICLES } from '../lib/vehicle';
import { useAuth } from '../lib/auth';
import { useFocusEffect } from '../lib/useFocusEffect';
import { useNav } from '../lib/nav';
import { light as c, lightRadius as lr, themed, statusBarStyle } from '../lib/theme';
import { bigUnit, formatKm } from '../lib/units';

export const ROUTE_TYPES: { key: RoutePreference; title: string; text: string; icon: McName }[] = [
  { key: 'smart', title: 'Smartest', text: 'Least total driving time. Stops at the same address are done together.', icon: 'lightbulb-on-outline' },
  { key: 'nearest_first', title: 'Nearest first', text: 'Always drive to the closest stop next.', icon: 'map-marker-radius-outline' },
  { key: 'shortest', title: 'Most efficient', text: 'The shortest total distance for the whole route.', icon: 'chart-timeline-variant' },
];

/**
 * Review stops, two ways in:
 * - Step 3 of Add route (`name`, `date`, `ids`): check the stops, choose how they are ordered, then plan the route.
 * - A planned, running or finished route from Home (`routeId`): its stops in route order with their status, its distance
 *   and time, and Preview route opens its map (where it is started or navigated). Tapping a stop opens it.
 */
export default function RoutePreview({ name, date, ids, routeId }: { name?: string; date?: string; ids?: string[]; routeId?: string }) {
  const { goBack, navigate, resetTo, resetTab } = useNav();
  const { user } = useAuth();
  const [stops, setStops] = useState<Delivery[] | null>(null);
  const [preference, setPreference] = useState<RoutePreference>(user?.routePreference || 'smart');
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState('');
  const [types, setTypes] = useState(false);
  // Existing route: it changes id when it is planned again with another route type.
  const [currentId, setCurrentId] = useState(routeId);
  const [route, setRoute] = useState<Route | null>(null);
  const [reordering, setReordering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const existing = !!routeId;
  // Bike or van: asked each time a route is planned (the last choice is ticked), and shown on a planned route.
  const [vehicle, setVehicle] = useState<Vehicle>('bike');
  const [askVehicle, setAskVehicle] = useState(false);
  // Where the route starts: chosen by the rider at the top before planning (never assumed). `askStart` holds why the
  // picker opened (empty: opened by the rider); after a pick from Preview route, planning carries on.
  const [start, setStart] = useState<StartPoint | null>(null);
  const [askStart, setAskStart] = useState<string | null>(null);
  const [continuePlan, setContinuePlan] = useState(false);
  // Why the last start point change did not go through (shown under the starting point).
  const [startError, setStartError] = useState('');
  useEffect(() => { if (!routeId) void lastVehicle().then(setVehicle); }, [routeId]);

  // Planning needs a plan (or its free trial): the server says so, and the paywall opens instead of an error.
  const paywall = (err: unknown) => {
    if (!(err instanceof ApiRequestError) || (err.code !== 'SUBSCRIPTION_REQUIRED' && err.code !== 'SUBSCRIPTION_EXPIRED')) return false;
    navigate('Paywall');
    return true;
  };

  const openStop = useCallback((d: Delivery) => navigate('DeliveryDetail', { id: d.id }), [navigate]);
  const showRoute = (r: Route) => { setRoute(r); setStops(r.stops.map((stop) => stop.delivery)); setPreference(r.preference); if (r.vehicle) setVehicle(r.vehicle); };

  useFocusEffect(useCallback(() => {
    if (!currentId) return;
    fetchRoute(currentId)
      .then((r) => { showRoute(r); setError(''); })
      .catch((err) => { setError(err instanceof ApiRequestError ? err.message : 'Could not load this route'); setStops((list) => list ?? []); });
  }, [currentId]));

  useFocusEffect(useCallback(() => {
    if (existing || !ids || !date) return;
    const wanted = new Set(ids);
    (async () => {
      try {
        const all: Delivery[] = [];
        for (let page = 1; page <= 3; page++) {
          const res = await get<Delivery[]>('/deliveries', { status: 'pending', date, limit: 100, page, sort: 'recent' });
          all.push(...res.data);
          if (!res.meta || page >= res.meta.pages) break;
        }
        const byId = new Map(all.map((d) => [d.id, d]));
        setStops(ids.flatMap((id) => (wanted.has(id) && byId.get(id) ? [byId.get(id)!] : [])));
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : 'Could not load your stops');
        setStops([]);
      }
    })();
  }, [existing, ids, date]));

  // The start point's coordinates: the typed place, or the phone's position now. Null (with the picker reopened) when
  // the phone cannot tell where it is.
  const originOf = async (point: StartPoint | null) => {
    if (point?.kind === 'place') return { latitude: point.latitude, longitude: point.longitude };
    if (!point && route?.origin) return route.origin;
    const here = await getRouteOrigin();
    if (!here) setAskStart('Your location is not available. Type the starting address instead.');
    return here;
  };

  // Existing planned route, another route type picked: plan the same stops again that way (the route is replaced).
  /** Plans the route again; resolves to the reason when it could not (also shown), else ''. */
  const replan = async (key: RoutePreference, by: Vehicle = vehicle, from: StartPoint | null = start): Promise<string> => {
    if (!route) return 'No route';
    setReordering(true);
    setError('');
    try {
      const origin = await originOf(from);
      if (!origin) return 'Your location is not available.';
      const open = route.stops.filter((stop) => stop.delivery.status === 'pending').map((stop) => stop.delivery.id);
      const built = await postPlan<Route>('/routes/build', { name: route.name, date: route.serviceDate, preference: key, vehicle: by, deliveryIds: open, ...(origin ? { origin } : {}) });
      showRoute(built.data);
      setCurrentId(built.data.id);
      return '';
    } catch (err) {
      if (paywall(err)) return 'A plan is needed';
      const message = err instanceof ApiRequestError
        ? err.code === 'ROUTE_ACTIVE' ? 'Another route is underway today. Put it on hold (on its map) or finish it, then this route can be planned again.' : err.message
        : 'Could not re-plan the route. Check your connection and try again.';
      setError(message);
      return message;
    } finally {
      setReordering(false);
    }
  };

  // Running route: re-order its open stops from where the rider is now.
  const reorder = async () => {
    if (!route) return;
    setReordering(true);
    setError('');
    try {
      const origin = await getRouteOrigin();
      showRoute((await postPlan<Route>(`/routes/${route.id}/optimize`, origin ? { origin } : {})).data);
    } catch (err) {
      if (!paywall(err)) setError(err instanceof ApiRequestError ? err.message : 'Could not optimise the route');
    } finally {
      setReordering(false);
    }
  };

  const plan = async (by: Vehicle) => {
    if (!name || !date) return;
    if (!stops?.length) return;
    setAskVehicle(false);
    setVehicle(by);
    rememberVehicle(by);
    setPlanning(true);
    setError('');
    try {
      const origin = await originOf(start);
      if (!origin) return;
      const built = await postPlan<Route>('/routes/build', { name, date, preference, vehicle: by, deliveryIds: stops.map((d) => d.id), ...(origin ? { origin } : {}) });
      void forgetRouteName(date);
      // The map drops the numbered pins in route order. Back from there returns Home, not to this form.
      resetTo('RouteMapScreen', { reveal: true, routeId: built.data.id });
    } catch (err) {
      if (!paywall(err)) setError(err instanceof ApiRequestError
        ? err.code === 'ROUTE_ACTIVE' ? 'Another route is underway. Put it on hold (on its map) or finish it first. Your new stops are saved and will be here.' : err.message
        : 'Could not plan the route. Check your connection and try again.');
    } finally {
      setPlanning(false);
    }
  };

  if (!stops) return <Screen style={{ backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.ink} /></Screen>;

  const type = ROUTE_TYPES.find((t) => t.key === preference) || ROUTE_TYPES[0];
  const routeName = route?.name || name || 'Route';
  const routeDate = route?.serviceDate || date || '';
  const km = route && route.distanceKm > 0 ? formatKm(route.distanceKm) : `— ${bigUnit()}`;
  const time = route && route.durationMin > 0 ? formatMinutes(route.durationMin) : '—';
  const finished = route?.status === 'completed';
  const onOptimise = () => { if (route?.status === 'active') void reorder(); else setTypes(true); };
  const pickType = (key: RoutePreference) => {
    setTypes(false);
    if (existing) { if (key !== preference) void replan(key); } else setPreference(key);
  };
  // A planned route driven with the other vehicle: its roads and order change, so it is planned again.
  const pickVehicle = (v: Vehicle) => {
    setTypes(false);
    if (v === vehicle) return;
    rememberVehicle(v);
    if (existing) void replan(preference, v); else setVehicle(v);
  };
  const vehicleInfo = VEHICLES.find((v) => v.key === vehicle) || VEHICLES[0];
  // Preview route: the start point first (asked for when not chosen), then the vehicle, then planning.
  const onPreview = () => {
    if (!start) { setContinuePlan(true); setAskStart('Choose where the route starts before it is planned.'); return; }
    setAskVehicle(true);
  };
  const pickStart = async (point: StartPoint) => {
    setAskStart(null);
    setStartError('');
    if (!existing) {
      setStart(point);
      if (continuePlan) { setContinuePlan(false); setAskVehicle(true); }
      return;
    }
    // A planned route is planned again from the new start; the start only changes once that worked.
    const failed = await replan(preference, vehicle, point);
    if (failed) setStartError(failed);
    else setStart(point);
  };
  // Changing the start of a planned route plans it again from there; a running route keeps its order (Optimise re-orders from the rider).
  const canChangeStart = !existing || route?.status === 'planned';

  const confirmDelete = () => {
    if (route) confirmDeleteRoute(route, { onDone: () => resetTab('home'), onError: setError, onBusy: setDeleting });
  };

  // Rows only change with these, so the list redraws a row only when it must.
  const rowMode: RowMode = existing ? (finished ? 'open-finished' : 'open') : 'draft';

  return (
    <Screen style={{ backgroundColor: c.background }}>
      <StatusBar style={statusBarStyle()} />
      <FlashList
        data={stops}
        keyExtractor={(d) => d.id}
        extraData={rowMode}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 120 }}
        renderItem={({ item, index }) => <PreviewRow delivery={item} index={index} mode={rowMode} onOpen={openStop} />}
        ListHeaderComponent={<>
        <View style={s.header}>
          <Pressable onPress={goBack} hitSlop={12} accessibilityLabel="Back to Add stops">
            <Ionicons name="arrow-back" size={26} color={c.text} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 18 }}>
            <Text style={s.title}>Review stops</Text>
            {/* Before planning, distance and time aren't known yet. MISSING: see missing.md */}
            <Text style={s.stats}>{stops.length} stop{stops.length === 1 ? '' : 's'} · approx {km} · {time}</Text>
            {/* Not in the design; kept so the rider can see which route and day these stops go to. */}
            <Text style={s.context} numberOfLines={1}>{routeName}{routeDate ? ` · ${dayLabel(routeDate)}` : ''}{route ? ` · ${ROUTE_STATE[route.status]} · ${vehicleInfo.title}` : ''}</Text>
            {existing && route && route.status !== 'completed' ? (
              <Pressable onPress={confirmDelete} disabled={deleting || reordering} hitSlop={6} style={({ pressed }) => [s.deleteRoute, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Delete route">
                {deleting ? <ActivityIndicator size="small" color={c.danger} /> : <Ionicons name="trash-outline" size={16} color={c.danger} />}
                <Text style={{ color: c.danger, fontSize: 14, fontWeight: '600' }}>Delete route</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {canChangeStart ? (
          <Pressable onPress={() => setAskStart('')} disabled={reordering || planning} style={({ pressed }) => [s.start, !start && !existing && s.startMissing, pressed && { opacity: 0.85 }]}
            accessibilityRole="button" accessibilityLabel="Starting point">
            <MaterialCommunityIcons name={start?.kind === 'place' ? 'map-marker-outline' : 'crosshairs-gps'} size={22} color={start || existing ? c.link : c.warning} />
            <View style={{ flex: 1 }}>
              <Text style={s.startLabel}>STARTING POINT</Text>
              <Text style={[s.startText, !start && !existing && { color: c.warning }]} numberOfLines={1}>
                {start ? start.label : existing ? 'Where it was planned from' : 'Choose a starting point'}
              </Text>
            </View>
            {reordering ? <ActivityIndicator size="small" color={c.link} /> : <Text style={s.link}>{start || existing ? 'Change' : 'Choose'}</Text>}
          </Pressable>
        ) : null}
        {startError ? <View style={{ marginTop: 10 }}><LightError text={startError} /></View> : null}

        {finished ? <View style={[s.toolbar, { paddingBottom: 0 }]} /> : (
          <View style={s.toolbar}>
            {/* The order is worked out when the route is planned; there is no manual order yet. MISSING: see missing.md */}
            <Text style={s.hint}>Drag to reorder</Text>
            <Pressable onPress={onOptimise} disabled={reordering} hitSlop={8} style={s.optimise} accessibilityLabel={`Optimise route: ${type.title}`}>
              {reordering ? <ActivityIndicator size="small" color={c.link} /> : <Ionicons name="sparkles-outline" size={20} color={c.link} />}
              <Text style={s.link}>Optimise route</Text>
            </Pressable>
          </View>
        )}

        </>}
        ListFooterComponent={<>
        {existing && !stops.length ? <Text style={{ color: c.textSecondary, fontSize: 15, marginTop: 16 }}>{route ? 'No stops on this route.' : 'Route not found. It may have been planned again as a new route.'}</Text> : null}
        <LightError text={error} />
        </>}
      />

      <View style={s.footer}>
        {existing ? (
          // The map is where a planned route is started and a running one is navigated.
          <LightButton title="Preview route" icon={<Ionicons name="map-outline" size={22} color={c.onInk} />}
            onPress={() => { if (currentId) navigate('RouteMapScreen', { routeId: currentId }); }} disabled={!route || reordering} />
        ) : (
          <LightButton title={planning ? 'Planning your route…' : 'Preview route'} icon={<Ionicons name="map-outline" size={22} color={c.onInk} />}
            onPress={onPreview} loading={planning} disabled={!stops.length} />
        )}
      </View>

      {/* Not in the design: the route type the old screen showed, now behind "Optimise route". */}
      <Modal visible={types} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setTypes(false)}>
        <Pressable style={s.backdrop} onPress={() => setTypes(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.grabber} />
            <Text style={s.sheetTitle}>Optimise route</Text>
            <Text style={s.sheetSub}>{existing ? 'Choose how the stops are ordered. The route is planned again that way.' : 'Choose how the stops are ordered when the route is planned.'}</Text>
            {route?.status !== 'active' ? (
              <View style={s.vehicles}>
                {VEHICLES.map((v) => (
                  <Pressable key={v.key} onPress={() => pickVehicle(v.key)} style={({ pressed }) => [s.vehicleChip, vehicle === v.key && s.vehicleChipOn, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button" accessibilityState={{ selected: vehicle === v.key }}>
                    <MaterialCommunityIcons name={v.icon} size={20} color={vehicle === v.key ? c.link : c.text} />
                    <Text style={{ color: vehicle === v.key ? c.link : c.text, fontWeight: '600', fontSize: 15 }}>{v.title}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {ROUTE_TYPES.map((t) => {
              const on = preference === t.key;
              return (
                <Pressable key={t.key} onPress={() => pickType(t.key)} style={({ pressed }) => [s.type, on && s.typeOn, pressed && { opacity: 0.85 }]}>
                  <MaterialCommunityIcons name={t.icon} size={22} color={on ? c.link : c.text} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '600', fontSize: 16 }}>{t.title}</Text>
                    <Text style={{ color: c.textSecondary, fontSize: 14, marginTop: 2, lineHeight: 19 }}>{t.text}</Text>
                  </View>
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? c.link : c.placeholder} />
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      <StartPointSheet visible={askStart !== null} reason={askStart || undefined} onPick={(point) => void pickStart(point)} onClose={() => { setAskStart(null); setContinuePlan(false); }} />

      {/* Asked before every new route: the roads, the stop order and the directions depend on it. */}
      <Modal visible={askVehicle} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setAskVehicle(false)}>
        <Pressable style={s.backdrop} onPress={() => setAskVehicle(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.grabber} />
            <Text style={s.sheetTitle}>What are you riding today?</Text>
            <Text style={s.sheetSub}>The route is planned on the roads your vehicle can use.</Text>
            {VEHICLES.map((v) => {
              const on = vehicle === v.key;
              return (
                <Pressable key={v.key} onPress={() => void plan(v.key)} style={({ pressed }) => [s.type, on && s.typeOn, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button" accessibilityLabel={`Plan by ${v.title}`}>
                  <MaterialCommunityIcons name={v.icon} size={26} color={on ? c.link : c.text} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '600', fontSize: 16 }}>{v.title}</Text>
                    <Text style={{ color: c.textSecondary, fontSize: 14, marginTop: 2, lineHeight: 19 }}>{v.text}</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={20} color={on ? c.link : c.placeholder} />
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

type Tag = { text: string; fg: string; bg: string; icon: ComponentProps<typeof Ionicons>['name'] };

const ROUTE_STATE: Record<Route['status'], string> = { planned: 'Planned', active: 'In progress', paused: 'On hold', completed: 'Completed' };

/** "Location not verified" for a stop not pinned exactly yet (it is looked up when the route is planned). */
// draft: stops being reviewed before planning; open: an existing route (rows open the stop); open-finished: also finished.
type RowMode = 'draft' | 'open' | 'open-finished';

/** One stop of the review list. Memoised: it redraws only when its stop, number or mode changes. */
const PreviewRow = memo(function PreviewRow({ delivery: d, index: i, mode, onOpen }: { delivery: Delivery; index: number; mode: RowMode; onOpen: (d: Delivery) => void }) {
  const { title, address } = stopCardText(d);
  const tag = d.status === 'pending' ? locationTag(d) : statusTag(d);
  return (
    <Pressable disabled={mode === 'draft'} onPress={() => onOpen(d)} style={({ pressed }) => [s.row, i > 0 && s.divider, pressed && { opacity: 0.7 }]}>
      <View style={s.badge}><Text style={{ color: c.text, fontWeight: '600', fontSize: 16 }}>{i + 1}</Text></View>
      <View style={{ flex: 1, marginLeft: 14, marginRight: 8 }}>
        <Text style={s.code} numberOfLines={address ? 1 : 2}>{title}</Text>
        {address ? <Text style={s.address} numberOfLines={3}>{address}</Text> : null}
        {tag ? (
          <View style={[s.tag, { backgroundColor: tag.bg }]}>
            <Ionicons name={tag.icon} size={16} color={tag.fg} />
            <Text style={{ color: tag.fg, fontSize: 14, fontWeight: '500' }}>{tag.text}</Text>
          </View>
        ) : null}
      </View>
      {mode === 'open-finished'
        ? <Ionicons name="chevron-forward" size={20} color={c.placeholder} style={{ marginTop: 2 }} />
        : <MaterialCommunityIcons name="drag-vertical" size={24} color={c.placeholder} style={{ marginTop: 2 }} />}
    </Pressable>
  );
});

function locationTag(d: Delivery): Tag | null {
  const { geocodeStatus: status, approximate } = d.address;
  if (status === 'found' && !approximate) return null;
  if (status === 'not_found') return { text: 'Location not found', fg: c.danger, bg: c.dangerBg, icon: 'warning-outline' };
  return { text: approximate || status === 'approximate' ? 'Approximate location' : 'Location not verified', fg: c.warning, bg: c.warningBg, icon: 'warning-outline' };
}

/** A stop that is underway or done on an existing route: Delivered, Failed, or the stop's own status. */
function statusTag(d: Delivery): Tag {
  const text = STOP_STATUS[d.status]?.label || d.status;
  if (d.status === 'delivered') return { text, fg: c.success, bg: c.successBg, icon: 'checkmark' };
  if (d.status === 'failed') return { text, fg: c.danger, bg: c.dangerBg, icon: 'close' };
  return { text, fg: c.link, bg: c.linkBg, icon: 'time-outline' };
}

const s = themed(() => ({
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { color: c.text, fontSize: 26, fontWeight: '700', lineHeight: 30 },
  stats: { color: c.textSecondary, fontSize: 16, marginTop: 6 },
  context: { color: c.placeholder, fontSize: 13, marginTop: 2 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: c.border },
  hint: { color: c.textSecondary, fontSize: 15 },
  optimise: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  link: { color: c.link, fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 18 },
  divider: { borderTopWidth: 1, borderTopColor: c.border },
  badge: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  code: { color: c.text, fontSize: 18, fontWeight: '700' },
  address: { color: c.textSecondary, fontSize: 16, lineHeight: 21, marginTop: 4 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginTop: 10 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 14, backgroundColor: c.background, borderTopWidth: 1, borderTopColor: c.border },
  backdrop: { flex: 1, backgroundColor: 'rgba(24,24,27,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 10, paddingBottom: 32 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.track, marginBottom: 20 },
  sheetTitle: { color: c.text, fontSize: 22, fontWeight: '700' },
  sheetSub: { color: c.textSecondary, fontSize: 15, marginTop: 6, marginBottom: 16 },
  type: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginBottom: 10, borderRadius: lr.field, borderWidth: 1, borderColor: c.border },
  typeOn: { borderColor: c.link, backgroundColor: c.linkBg },
  vehicles: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  deleteRoute: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: c.dangerBg },
  start: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, padding: 14, borderRadius: lr.field, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  startMissing: { borderColor: c.warning, backgroundColor: c.warningBg },
  startLabel: { color: c.textSecondary, fontSize: 12, fontWeight: '600', letterSpacing: 1.1 },
  startText: { color: c.text, fontSize: 16, fontWeight: '600', marginTop: 2 },
  vehicleChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: lr.field, borderWidth: 1, borderColor: c.border },
  vehicleChipOn: { borderColor: c.link, backgroundColor: c.linkBg },
}));
