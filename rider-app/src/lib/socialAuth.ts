import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

// "Continue with Google" on Android and "Sign in with Apple" on iPhone. The phone's own sign-in gives an ID token,
// which our API checks with Google / Apple and turns into a Routify session (POST /auth/google, /auth/apple).
// Both are native modules: loaded only when present, so Expo Go and older builds simply hide the buttons.

/** The Web OAuth client id from Google Cloud: Google issues the ID token for it, and our API checks that. */
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export const googleAvailable = Platform.OS === 'android' && !!GOOGLE_WEB_CLIENT_ID && !!requireOptionalNativeModule('RNGoogleSignin');
const appleNative = Platform.OS === 'ios' && !!requireOptionalNativeModule('ExpoAppleAuthentication');

export type SocialResult = { provider: 'google' | 'apple'; idToken: string; fullName?: string } | null;

/** Opens Google's account picker. Null when the rider closes it. */
export async function googleIdToken(): Promise<SocialResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module, loaded only in builds that have it
  const { GoogleSignin, isErrorWithCode, statusCodes } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (res.type !== 'success') return null;
    // Our session is ours from here: signing out of Google's side makes the picker show again next time.
    void GoogleSignin.signOut().catch(() => {});
    if (!res.data.idToken) throw new Error('Google did not return a sign-in token');
    return { provider: 'google', idToken: res.data.idToken, fullName: res.data.user.name ?? undefined };
  } catch (err) {
    if (isErrorWithCode(err) && (err.code === statusCodes.SIGN_IN_CANCELLED || err.code === statusCodes.IN_PROGRESS)) return null;
    if (isErrorWithCode(err) && err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new Error('Google Play services are needed to continue with Google.');
    throw err;
  }
}

/** Sign in with Apple is available on this iPhone (iOS 13+). */
export async function appleAvailable(): Promise<boolean> {
  if (!appleNative) return false;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module, loaded only in builds that have it
  const Apple = require('expo-apple-authentication') as typeof import('expo-apple-authentication');
  return Apple.isAvailableAsync().catch(() => false);
}

/** Apple's sign-in sheet. Null when the rider cancels. The name comes only the first time, so it is passed on. */
export async function appleIdToken(): Promise<SocialResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module, loaded only in builds that have it
  const Apple = require('expo-apple-authentication') as typeof import('expo-apple-authentication');
  try {
    const credential = await Apple.signInAsync({ requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL] });
    if (!credential.identityToken) throw new Error('Apple did not return a sign-in token');
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
    return { provider: 'apple', idToken: credential.identityToken, fullName: name || undefined };
  } catch (err) {
    if ((err as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return null;
    throw err;
  }
}
