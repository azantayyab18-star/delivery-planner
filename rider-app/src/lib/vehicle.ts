import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Vehicle } from './types';

// What the rider drives. The route planner, road distances and turn-by-turn directions follow it: a bike may use cycle
// lanes and paths a van cannot, and a van keeps to roads open to cars. The last choice is kept as the next default.
const KEY = 'dp_vehicle_v1';

export const VEHICLES: { key: Vehicle; title: string; text: string; icon: 'bicycle' | 'van-utility' }[] = [
  { key: 'bike', title: 'Bike', text: 'Cycle lanes and short cuts. Best for city-centre drops.', icon: 'bicycle' },
  { key: 'van', title: 'Van', text: 'Roads open to cars only, for bigger loads and longer runs.', icon: 'van-utility' },
];

let current: Vehicle = 'bike';
let loaded: Promise<Vehicle> | null = null;

/** The rider's last vehicle (Bike until they pick one). */
export function lastVehicle(): Promise<Vehicle> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((v) => { if (v === 'bike' || v === 'van') current = v; return current; })
    .catch(() => current);
  return loaded;
}

/** The vehicle in use now, for directions opened outside a route screen's own state. */
export const currentVehicle = () => current;

/** Remembers the vehicle the rider picked, or the one of the route they are looking at. */
export function rememberVehicle(v: Vehicle | null | undefined) {
  if (v !== 'bike' && v !== 'van') return;
  current = v;
  loaded = Promise.resolve(v);
  void AsyncStorage.setItem(KEY, v).catch(() => {});
}

void lastVehicle();
