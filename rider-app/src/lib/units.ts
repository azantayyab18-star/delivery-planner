// Distances in the rider's units: kilometres and metres, or miles and yards (UK riders). The server always works in km;
// only what is shown and said changes. Set by AppearanceProvider (Account → Units) before screens draw.
export type Units = 'km' | 'mi';

const MI = 1.609344;
const YD = 0.9144;
let units: Units = 'km';

export const currentUnits = () => units;
export function applyUnits(next: Units) { units = next; }

/** The unit word for big distances: "km" or "mi". */
export const bigUnit = () => (units === 'mi' ? 'mi' : 'km');

/** A distance in km as a number in the rider's big unit. */
export const inBigUnit = (km: number) => (units === 'mi' ? km / MI : km);

/** "12.3 km" / "7.6 mi"; whole numbers from 10 up. */
export function formatKm(km: number, { whole = false }: { whole?: boolean } = {}) {
  const v = inBigUnit(km);
  return `${whole || v >= 10 ? Math.round(v).toLocaleString() : v.toFixed(1)} ${bigUnit()}`;
}

/** A short distance from metres: "200 m" / "220 yd" below 1 km (a tenth of a mile), else formatKm. */
export function formatMeters(m: number) {
  if (units === 'mi') {
    const yards = m / YD;
    if (yards < 176) return `${Math.max(10, Math.round(yards / 10) * 10)} yd`;
    const miles = m / 1000 / MI;
    return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
  }
  if (m < 1000) return `${m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** formatMeters in words, for the voice: "200 metres", "1.2 miles". */
export const spokenMeters = (m: number) => formatMeters(m)
  .replace(/ m$/, ' metres').replace(/ km$/, ' kilometres').replace(/ yd$/, ' yards').replace(/^1\.0 mi$|^1 mi$/, '1 mile').replace(/ mi$/, ' miles');
