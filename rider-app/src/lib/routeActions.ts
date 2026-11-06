import { Alert } from 'react-native';
import { ApiRequestError, del } from './api';
import { queryClient } from './query';
import type { Route } from './types';

/**
 * Asks, then deletes a route (planned or underway). The rider chooses whether the stops not done yet stay (unplanned,
 * same day, to plan again) or go too; delivered and failed stops always stay in History. `onDone` runs after a delete
 * (e.g. back to Home), `onError` gets the reason when it failed, `onBusy` brackets the request.
 */
export function confirmDeleteRoute(route: Route, { onDone, onError, onBusy }: {
  onDone: () => void; onError: (message: string) => void; onBusy?: (busy: boolean) => void;
}) {
  const open = route.stops.filter((st) => st.delivery.status === 'pending' || st.delivery.status === 'in_progress').length;
  const remove = (keepStops: boolean) => {
    onBusy?.(true);
    del<{ stopsKept: number; stopsDeleted: number }>(`/routes/${route.id}?keepStops=${keepStops}`)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ['home'] });
        onDone();
      })
      .catch((err) => onError(err instanceof ApiRequestError ? err.message : 'Could not delete the route. Check your connection and try again.'))
      .finally(() => onBusy?.(false));
  };
  const them = open === 1 ? 'it' : 'them';
  Alert.alert(
    route.status === 'active' ? `Delete ${route.name || 'this route'}? It is underway.` : `Delete ${route.name || 'this route'}?`,
    open ? `${open} stop${open === 1 ? ' is' : 's are'} not done yet. Keep ${them} to plan again, or delete ${them} too. Delivered and failed stops stay in History.`
      : 'Delivered and failed stops stay in History.',
    [
      { text: 'Cancel', style: 'cancel' },
      ...(open ? [{ text: 'Delete route and stops', style: 'destructive' as const, onPress: () => remove(false) }] : []),
      { text: open ? 'Delete route, keep stops' : 'Delete route', style: open ? 'default' as const : 'destructive' as const, onPress: () => remove(true) },
    ],
  );
}
