import { useRef } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';
import { light as c, themed } from '../lib/theme';

// The page drawn inside the pad: no border or buttons of its own (ours are native), a white sheet with dark ink.
const PAD_CSS = `.m-signature-pad { box-shadow: none; border: none; margin: 0; height: 100%; }
  .m-signature-pad--body { border: none; }
  .m-signature-pad--footer { display: none; }
  body, html { height: 100%; margin: 0; background: #ffffff; }`;

/**
 * The customer signs on the phone's screen (optional proof of delivery). Full screen, so the page under it cannot
 * scroll while they sign. Gives back a PNG as a data URL; nothing when they cancel or leave it empty.
 */
export default function SignaturePad({ visible, onDone, onClose }: { visible: boolean; onDone: (png: string) => void; onClose: () => void }) {
  const pad = useRef<SignatureViewRef>(null);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[s.page, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={s.head}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Cancel" style={s.icon}>
            <Ionicons name="close" size={26} color={c.text} />
          </Pressable>
          <Text style={s.title}>Customer signature</Text>
          <Pressable onPress={() => pad.current?.clearSignature()} hitSlop={10} accessibilityRole="button">
            <Text style={s.clear}>Clear</Text>
          </Pressable>
        </View>
        <Text style={s.hint}>Ask the customer to sign inside the box.</Text>
        <View style={s.box}>
          <SignatureScreen
            ref={pad}
            webStyle={PAD_CSS}
            penColor="#18181B"
            backgroundColor="#ffffff"
            imageType="image/png"
            trimWhitespace
            // readSignature() answers here with the PNG, or onEmpty when nothing was drawn.
            onOK={onDone}
            onEmpty={() => {}}
          />
          <View pointerEvents="none" style={s.line} />
        </View>
        <Pressable onPress={() => pad.current?.readSignature()} style={({ pressed }) => [s.save, pressed && { opacity: 0.88 }]} accessibilityRole="button">
          <Ionicons name="checkmark" size={22} color={c.onInk} />
          <Text style={{ color: c.onInk, fontSize: 18, fontWeight: '700' }}>Save signature</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = themed(() => ({
  page: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: c.text, fontSize: 19, fontWeight: '700' },
  clear: { color: c.link, fontSize: 16, fontWeight: '600', paddingHorizontal: 6 },
  hint: { color: c.textSecondary, fontSize: 15, marginTop: 8, marginBottom: 14 },
  // White in both themes: a signature is dark ink on paper.
  box: { flex: 1, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: c.border, backgroundColor: '#ffffff' },
  line: { position: 'absolute', left: 24, right: 24, bottom: 56, height: 1, backgroundColor: '#D4D4D8' },
  save: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 56, borderRadius: 16, backgroundColor: c.ink, marginTop: 16 },
}));
