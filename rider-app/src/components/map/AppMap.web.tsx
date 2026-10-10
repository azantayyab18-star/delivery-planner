import { Text, View } from 'react-native';
import { premium as c } from '../../lib/theme';
import type { AppMapProps } from './types';

// The native map library has no web build; the live map is a phone feature.
export const hasNativeMap = false;

export default function AppMap({ style }: AppMapProps) {
  return (
    <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: c.surface }, style]}>
      <Text style={{ color: c.textSecondary, fontSize: 13, textAlign: 'center' }}>The live map is available in the mobile app.</Text>
    </View>
  );
}
