import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { useAuth } from '../lib/auth';
import { ApiRequestError } from '../lib/api';
import { appleAvailable, appleIdToken, googleAvailable, googleIdToken, type SocialResult } from '../lib/socialAuth';
import { currentScheme } from '../lib/theme';
import { GoogleButton, LightDivider } from './LightKit';

/**
 * The "or" divider and the phone's own sign-in: Continue with Google on Android, Sign in with Apple on iPhone. Signs
 * in an existing rider, links an account with the same email, or creates a new one. Hidden when not available.
 */
export default function SocialSignIn({ onError }: { onError: (message: string) => void }) {
  const { socialSignIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [apple, setApple] = useState(false);
  useEffect(() => { void appleAvailable().then(setApple); }, []);

  const run = async (get: () => Promise<SocialResult>) => {
    setBusy(true);
    onError('');
    try {
      const result = await get();
      if (result) await socialSignIn(result.provider, result.idToken, result.fullName);
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : err instanceof TypeError ? 'Could not connect. Check your internet connection.'
        : err instanceof Error && err.message ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  if (!googleAvailable && !apple) return null;
  return (
    <>
      <LightDivider />
      {googleAvailable ? <GoogleButton onPress={() => void run(googleIdToken)} loading={busy} /> : null}
      {apple ? <AppleButton disabled={busy} onPress={() => void run(appleIdToken)} /> : null}
    </>
  );
}

/** Apple's own button (Apple requires it), black on light screens and white on dark ones. */
function AppleButton({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  if (Platform.OS !== 'ios' || !requireOptionalNativeModule('ExpoAppleAuthentication')) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module, loaded only in builds that have it
  const Apple = require('expo-apple-authentication') as typeof import('expo-apple-authentication');
  return (
    <View pointerEvents={disabled ? 'none' : 'auto'} style={{ opacity: disabled ? 0.5 : 1 }}>
      <Apple.AppleAuthenticationButton
        buttonType={Apple.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={currentScheme() === 'dark' ? Apple.AppleAuthenticationButtonStyle.WHITE : Apple.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={16}
        style={{ height: 54, width: '100%' }}
        onPress={onPress}
      />
    </View>
  );
}
