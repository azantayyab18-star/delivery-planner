import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AppMap from '../components/map/AppMap';
import { PButton } from '../components/Premium';
import { useRiderLocation } from '../hooks/useRiderLocation';
import { premium as c, premiumRadius as r, premiumShadow } from '../lib/theme';

// Live map with the rider's position. Stop markers, route lines and navigation come later
// as AppMap children.
export default function MapScreen() {
  const { location, status, retry, openSettings } = useRiderLocation();
  const [following, setFollowing] = useState(true);

  if (status === 'denied' || status === 'error') {
    return (
      <View style={s.message}>
        <Ionicons name="location-outline" size={40} color={c.primary} />
        <Text style={s.title}>{status === 'denied' ? 'Location is turned off' : 'Could not get your location'}</Text>
        <Text style={s.body}>
          {status === 'denied'
            ? 'Allow location access for Delivery Rider in your device settings to see where you are on the map.'
            : 'Check that location services are on, then try again.'}
        </Text>
        {status === 'denied' ? <PButton title="Open settings" icon="settings-outline" onPress={openSettings} style={{ marginBottom: 12, alignSelf: 'stretch' }} /> : null}
        <PButton title="Try again" icon="refresh" variant="secondary" onPress={retry} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppMap userLocation={location} followUser={following} onUserPan={() => setFollowing(false)} />

      {!location ? (
        <View style={s.loading} pointerEvents="none">
          <ActivityIndicator color={c.primary} />
          <Text style={s.loadingText}>Finding your location…</Text>
        </View>
      ) : null}

      {location && !following ? (
        <Pressable onPress={() => setFollowing(true)} style={({ pressed }) => [s.recentre, pressed && { opacity: 0.85 }]} hitSlop={8}>
          <Ionicons name="locate" size={18} color={c.primary} />
          <Text style={s.recentreText}>Re-centre</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: c.background },
  title: { color: c.text, fontSize: 18, fontWeight: '800', marginTop: 14, textAlign: 'center' },
  body: { color: c.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 22, textAlign: 'center' },
  loading: { position: 'absolute', top: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surfaceElevated, paddingHorizontal: 14, paddingVertical: 10, borderRadius: r.pill, borderWidth: 1, borderColor: c.border, ...premiumShadow },
  loadingText: { color: c.text, fontSize: 13, fontWeight: '600' },
  recentre: { position: 'absolute', right: 16, bottom: 28, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.surfaceElevated, paddingHorizontal: 14, paddingVertical: 11, borderRadius: r.pill, borderWidth: 1, borderColor: c.border, ...premiumShadow },
  recentreText: { color: c.text, fontSize: 13, fontWeight: '800' },
});
