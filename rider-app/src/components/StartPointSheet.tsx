import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { ApiRequestError } from '../lib/api';
import { newPlaceSession, pickPlace, searchPlaces, type PlaceSuggestion } from '../lib/places';
import { light as c, lightRadius as lr, themed } from '../lib/theme';

/** Where a route starts: the phone's location when it is planned, or a place the rider typed (depot, home, shop). */
export type StartPoint = { kind: 'gps'; label: string } | { kind: 'place'; label: string; latitude: number; longitude: number };

export const CURRENT_LOCATION: StartPoint = { kind: 'gps', label: 'Current location' };

/**
 * The start point picker: "Use my current location", or search an address (the only Google use here: place search).
 * `reason` explains why it opened, e.g. when the rider tried to plan without choosing one.
 */
export default function StartPointSheet({ visible, reason, onPick, onClose }: {
  visible: boolean; reason?: string; onPick: (start: StartPoint) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const session = useRef(newPlaceSession());

  // Starts empty each time it opens.
  const reset = () => { setQuery(''); setResults([]); setError(''); };
  const close = () => { reset(); onClose(); };
  const done = (start: StartPoint) => { reset(); onPick(start); };

  // Suggestions while typing, a moment after the last key (one billing session per pick).
  const q = query.trim();
  const shown = q.length >= 3 ? results : [];
  useEffect(() => {
    if (q.length < 3) return;
    const cancel = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      searchPlaces(q, session.current, null, cancel.signal)
        .then((list) => { setResults(list); setError(''); })
        .catch((err) => { if (!cancel.signal.aborted) setError(err instanceof ApiRequestError ? err.message : 'Could not search. Check your connection.'); })
        .finally(() => { if (!cancel.signal.aborted) setSearching(false); });
    }, 350);
    return () => { clearTimeout(timer); cancel.abort(); setSearching(false); };
  }, [q]);

  const choose = async (suggestion: PlaceSuggestion) => {
    setPicking(suggestion.label);
    try {
      const point = await pickPlace(suggestion, session.current);
      session.current = newPlaceSession();
      if (!point) { setError('That place has no exact location. Try another.'); return; }
      done({ kind: 'place', label: suggestion.label, latitude: point.latitude, longitude: point.longitude });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not use that place');
    } finally {
      setPicking(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      {/* The sheet rises above the keyboard while an address is typed. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={s.backdrop} onPress={close}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
          <View style={s.grabber} />
          <Text style={s.title}>Starting point</Text>
          <Text style={[s.sub, reason ? { color: c.warning } : null]}>{reason || 'Where does this route start? The stops are ordered from here.'}</Text>

          <Pressable onPress={() => done(CURRENT_LOCATION)} style={({ pressed }) => [s.option, pressed && { opacity: 0.85 }]} accessibilityRole="button">
            <View style={s.icon}><MaterialCommunityIcons name="crosshairs-gps" size={22} color={c.link} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.optionTitle}>Use my current location</Text>
              <Text style={s.optionSub}>Where the phone is when the route is planned</Text>
            </View>
          </Pressable>

          <View style={s.field}>
            <Ionicons name="search" size={20} color={c.textSecondary} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Or type an address, Eircode or place" placeholderTextColor={c.placeholder}
              style={s.input} autoCorrect={false} returnKeyType="search" />
            {searching ? <ActivityIndicator size="small" color={c.textSecondary} /> : null}
          </View>
          {error ? <Text style={{ color: c.danger, fontSize: 14, marginTop: 8 }}>{error}</Text> : null}
          {shown.map((r) => (
            <Pressable key={`${r.placeId ?? ''}|${r.label}`} onPress={() => void choose(r)} disabled={!!picking} style={({ pressed }) => [s.result, pressed && { opacity: 0.7 }]}>
              <Ionicons name="location-outline" size={20} color={c.textSecondary} />
              <Text style={s.resultText} numberOfLines={2}>{r.label}</Text>
              {picking === r.label ? <ActivityIndicator size="small" color={c.link} /> : null}
            </Pressable>
          ))}
          </ScrollView>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = themed(() => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(24,24,27,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 10, paddingBottom: 32, maxHeight: '90%' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.track, marginBottom: 20 },
  title: { color: c.text, fontSize: 22, fontWeight: '700' },
  sub: { color: c.textSecondary, fontSize: 15, marginTop: 6, marginBottom: 16 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: lr.field, borderWidth: 1, borderColor: c.border },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.linkBg, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { color: c.text, fontSize: 16, fontWeight: '600' },
  optionSub: { color: c.textSecondary, fontSize: 14, marginTop: 2 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingHorizontal: 14, marginTop: 14, borderRadius: lr.field, backgroundColor: c.soft },
  input: { flex: 1, color: c.text, fontSize: 16, paddingVertical: 10 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border },
  resultText: { flex: 1, color: c.text, fontSize: 15 },
}));
