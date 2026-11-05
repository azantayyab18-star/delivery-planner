import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';

// Spoken turn-by-turn directions with the phone's own text-to-speech engine: free, works offline, no API or server.
const KEY = 'dp_nav_voice_v1';
let muted = false;
void AsyncStorage.getItem(KEY).then((v) => { muted = v === 'off'; }).catch(() => {});

export const voiceMuted = () => muted;

export function setVoiceMuted(next: boolean) {
  muted = next;
  if (next) void Speech.stop();
  void AsyncStorage.setItem(KEY, next ? 'off' : 'on').catch(() => {});
}

/** Says `text` at once, cutting off anything still being said (an older instruction is out of date). */
export function say(text: string) {
  if (muted || !text) return;
  void Speech.stop();
  Speech.speak(text, { language: 'en-GB', rate: 1.0, pitch: 1.0 });
}

export const stopSpeaking = () => { void Speech.stop(); };
