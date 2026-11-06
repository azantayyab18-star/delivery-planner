import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Screen } from '../components/Kit';
import { LightButton } from '../components/LightKit';
import { get } from '../lib/api';
import type { PublicConfig } from '../lib/types';
import { useNav } from '../lib/nav';
import { light as c, statusBarStyle, themed } from '../lib/theme';

// Short answers to what riders ask most; anything else goes to support by email.
const TOPICS: { title: string; body: string }[] = [
  { title: 'Plan a route', body: 'Home → Add route: pick the day and a name, add stops (type, scan an Eircode or barcode, or import a PDF), then Review stops. Choose the starting point and Bike or Van, and the stops are put in the best order.' },
  { title: 'Bike or van', body: 'A bike route may use cycle lanes and short cuts. A van route keeps to roads open to cars and follows one-way streets. You choose each time a route is planned.' },
  { title: 'Navigate', body: 'On the route map, tap Start navigation. Directions are spoken at each turn (tap the speaker to mute). If you take another road, the way to the next stop is worked out again; the order of your stops stays the same.' },
  { title: 'Deliver or fail a stop', body: 'Tap Delivered and add a photo, and the customer’s signature if you like (both optional). Tap Failed to pick a reason. The next stop opens by itself.' },
  { title: 'No signal', body: 'Everything you do is saved on the phone first and sent when you are back online. The banner at the top shows anything still waiting.' },
  { title: 'Change the order', body: 'Review stops → Optimise route re-orders the stops that are left, from where you are now.' },
  { title: 'Delete a route', body: 'Open the route’s stops (Review stops) and tap Delete route. Delivered and failed stops always stay in History.' },
  { title: 'Plan and billing', body: 'Account → Subscription & plans shows your plan. Plans are bought and cancelled in Google Play or the App Store.' },
];

export default function Help() {
  const { goBack } = useNav();
  const [open, setOpen] = useState<number | null>(0);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  useEffect(() => { get<PublicConfig>('/config').then((res) => setConfig(res.data)).catch(() => {}); }, []);

  return (
    <Screen style={{ backgroundColor: c.background }}>
      <StatusBar style={statusBarStyle()} />
      <View style={s.topBar}>
        <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={s.back}>
          <Ionicons name="arrow-back" size={26} color={c.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}>
        <Text style={s.title}>Help</Text>
        {TOPICS.map((t, i) => (
          <View key={t.title} style={s.item}>
            <Pressable onPress={() => setOpen(open === i ? null : i)} style={s.head} accessibilityRole="button" accessibilityState={{ expanded: open === i }}>
              <Text style={s.question}>{t.title}</Text>
              <Ionicons name={open === i ? 'chevron-up' : 'chevron-down'} size={20} color={c.textSecondary} />
            </Pressable>
            {open === i ? <Text style={s.answer}>{t.body}</Text> : null}
          </View>
        ))}
        <Text style={s.more}>Still stuck? We usually answer within a day.</Text>
        <LightButton title="Email support" variant="outline" disabled={!config?.supportEmail}
          onPress={() => { if (config?.supportEmail) void Linking.openURL(`mailto:${config.supportEmail}`); }} style={{ marginTop: 12 }} />
      </ScrollView>
    </Screen>
  );
}

const s = themed(() => ({
  topBar: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: c.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginTop: 8, marginBottom: 16 },
  item: { borderBottomWidth: 1, borderBottomColor: c.border },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16 },
  question: { color: c.text, fontSize: 17, fontWeight: '600', flex: 1, marginRight: 12 },
  answer: { color: c.textSecondary, fontSize: 15, lineHeight: 22, paddingBottom: 16, marginTop: -4 },
  more: { color: c.textSecondary, fontSize: 15, marginTop: 28 },
}));
