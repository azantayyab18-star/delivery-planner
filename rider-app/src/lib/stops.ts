import { api, post } from './api';
import { findDuplicate, type Duplicate } from './duplicates';
import { findEircode } from './format';
import type { Delivery, GeocodeCheck } from './types';
import { submitStops } from './outbox';
import type { AddressCheck } from './importCheck';

type Point = { latitude: number; longitude: number };

/** Looks an address up on the map (Ireland, biased to `near` or the rider's service area) without saving anything. */
export async function checkAddress(address: string, near: Point | null): Promise<GeocodeCheck> {
  return (await post<GeocodeCheck>('/deliveries/geocode-check', { address, ...(near || {}) })).data;
}

/**
 * Addresses per batch check. Small batches each finish well inside the time limit even when the server is far from its
 * database or the map provider is slow (a 100-address batch could take over a minute), and the progress bar moves.
 */
const CHECK_BATCH = 25;
// A batch waits on up to 25 map lookups: longer than an ordinary request may take.
const CHECK_TIMEOUT_MS = 120_000;
const NOT_CHECKED: AddressCheck = { found: false, approximate: false, latitude: null, longitude: null, normalized: null, postalCode: null, error: true };

/**
 * Looks many addresses up without saving anything (Import), in batches so `onProgress` can move a bar. Each result
 * lines up with its address; one the map could not be asked about has `error: true`. A batch that fails (timeout, a
 * dropped connection) marks only its own addresses `error`, so the rest are still checked; only when every batch fails
 * is the error thrown, so the screen can say why.
 */
export async function checkAddresses(addresses: readonly string[], near: Point | null, onProgress?: (done: number) => void): Promise<AddressCheck[]> {
  const out: AddressCheck[] = [];
  let lastError: unknown = null;
  let anyChecked = false;
  for (let i = 0; i < addresses.length; i += CHECK_BATCH) {
    const chunk = addresses.slice(i, i + CHECK_BATCH);
    try {
      const res = await api<{ results: AddressCheck[] }>('/deliveries/geocode-check-batch', { method: 'POST', body: { addresses: chunk, ...(near || {}) }, timeoutMs: CHECK_TIMEOUT_MS });
      out.push(...res.data.results);
      anyChecked = true;
    } catch (err) {
      lastError = err;
      out.push(...chunk.map(() => NOT_CHECKED));
    }
    onProgress?.(out.length);
  }
  if (!anyChecked && lastError) throw lastError;
  return out;
}

/** Thrown by createStop instead of saving a stop that is already on the list. */
export class DuplicateStopError extends Error {
  constructor(readonly duplicate: Duplicate<Delivery>) {
    super(`Already in your stops (#${duplicate.index + 1})${duplicate.eircode ? `: ${duplicate.eircode}` : ''}`);
    this.name = 'DuplicateStopError';
  }
}

/**
 * Saves one stop for a day: the one way every entry path adds a stop. `normalized` is the address the map found for
 * what was typed (e.g. the street of a place name or an Eircode); `location` is the point to use, or null to let the
 * server look it up; `precise` says the point is the door, not an area. A stop that duplicates one in `existing`
 * (same Eircode, or within 15 m) is not saved unless `allowDuplicate` (two parcels for one house).
 */
export async function createStop({ raw, parcel, date, location, normalized, precise = true, existing, allowDuplicate = false }: {
  raw: string; parcel: string; date: string; location: Point | null; normalized?: string | null; precise?: boolean;
  existing: readonly Delivery[]; allowDuplicate?: boolean;
}): Promise<Delivery> {
  if (!allowDuplicate) {
    const duplicate = findDuplicate({ eircode: findEircode(raw) || findEircode(normalized), point: precise ? location : null }, existing);
    if (duplicate) throw new DuplicateStopError(duplicate);
  }
  // Through the outbox (P4.1): saved at once when online; offline it is kept on the phone (a stand-in flagged
  // pending_sync is returned) and sent later. The phone's own id means a retry never adds it twice. "Add anyway" on a
  // same-Eircode stop is a second parcel (P4.7).
  const [saved] = await submitStops([{
    trackingId: parcel.trim().toUpperCase(),
    address: { raw, ...(normalized && normalized !== raw ? { normalized: normalized.slice(0, 400) } : {}) },
    serviceDate: date,
    ...(location ? { location } : {}),
    ...(allowDuplicate ? { secondParcel: true } : {}),
  }]);
  return saved;
}
