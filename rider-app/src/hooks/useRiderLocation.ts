import { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import type { LatLng } from '../components/map/types';

export type RiderLocationStatus = 'loading' | 'granted' | 'denied' | 'error';

export type RiderLocation = LatLng & { accuracy: number | null; heading: number | null; timestamp: number };

// Live foreground position of the rider. Asks for "while in use" permission only, and stops
// watching when the screen using it unmounts. Reused later for stop markers and navigation.
export function useRiderLocation({ timeInterval = 5000, distanceInterval = 10 }: { timeInterval?: number; distanceInterval?: number } = {}) {
  const [location, setLocation] = useState<RiderLocation | null>(null);
  const [status, setStatus] = useState<RiderLocationStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      try {
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (!permission.granted) { setStatus('denied'); return; }

        setStatus('granted');
        const watcher = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval, distanceInterval },
          (p) => setLocation({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading, timestamp: p.timestamp }),
        );
        if (cancelled) watcher.remove();
        else subscription = watcher;
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [timeInterval, distanceInterval, attempt]);

  /** Ask again, e.g. after the rider returns from device settings. */
  const retry = useCallback(() => { setStatus('loading'); setAttempt((n) => n + 1); }, []);
  const openSettings = useCallback(() => { Linking.openSettings(); }, []);

  return { location, status, retry, openSettings };
}
