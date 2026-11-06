import { formatMeters, spokenMeters } from './units';

// Turn-by-turn guidance from our own OSRM's steps (POST /v2/navigation/route): what the next turn is, how far away it
// is, what to say out loud and when, and whether the rider has left the route. No Google service is involved.

export type Point = { latitude: number; longitude: number };
/** One OSRM step: its maneuver is at the step's start (`location` is [longitude, latitude]); `distance` follows it. */
export type Step = {
  distance: number; duration: number; name: string;
  maneuver: { type: string; modifier?: string; location?: [number, number]; exit?: number };
};
export type Icon =
  | 'arrow-up' | 'arrow-top-left' | 'arrow-top-right' | 'arrow-bottom-left' | 'arrow-bottom-right' | 'arrow-u-down-left'
  | 'arrow-u-down-right' | 'rotate-right' | 'rotate-left' | 'flag-checkered' | 'call-merge' | 'call-split' | 'navigation-variant';

// The rider counts as at a turn within this distance of it, and off the route farther than this from its line.
export const AT_TURN_METERS = 25;
export const OFF_ROUTE_METERS = 40;

export function metersBetween(a: Point, b: Point) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

export const stepPoint = (step: Step | undefined): Point | null =>
  step?.maneuver.location ? { latitude: step.maneuver.location[1], longitude: step.maneuver.location[0] } : null;

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** "Turn left onto High Street" and its arrow, for a step's maneuver. */
export function instruction(step: Step | undefined): { text: string; icon: Icon } {
  if (!step) return { text: 'Head to the stop', icon: 'navigation-variant' };
  const { type, modifier = '', exit } = step.maneuver;
  const onto = step.name ? ` onto ${step.name}` : '';
  const left = modifier.includes('left');
  const right = modifier.includes('right');
  const icon: Icon = modifier === 'uturn' ? 'arrow-u-down-left'
    : left ? (modifier.includes('sharp') ? 'arrow-bottom-left' : 'arrow-top-left')
      : right ? (modifier.includes('sharp') ? 'arrow-bottom-right' : 'arrow-top-right') : 'arrow-up';
  if (type === 'arrive') return { text: 'Arrive at the stop', icon: 'flag-checkered' };
  if (type === 'depart') return { text: `Head ${step.name ? `along ${step.name}` : 'off'}`, icon: 'navigation-variant' };
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') {
    return { text: exit ? `At the roundabout, take the ${ordinal(exit)} exit${onto}` : `Go through the roundabout${onto}`, icon: left ? 'rotate-left' : 'rotate-right' };
  }
  if (type === 'exit roundabout' || type === 'exit rotary') return { text: `Exit the roundabout${onto}`, icon };
  if (modifier === 'uturn') return { text: `Make a U-turn${onto}`, icon };
  if (type === 'merge') return { text: `Merge${onto}`, icon: 'call-merge' };
  if (type === 'fork') return { text: `Keep ${left ? 'left' : 'right'}${onto}`, icon: 'call-split' };
  if (modifier === 'straight' || type === 'continue' || type === 'new name') return { text: `Continue${onto || ' straight on'}`, icon: 'arrow-up' };
  if (left || right) {
    const how = modifier.startsWith('slight') ? 'Bear' : 'Turn';
    const side = modifier.replace('slight ', '').replace('sharp ', 'sharp ');
    return { text: `${how} ${side}${onto}`, icon };
  }
  return { text: `Continue${onto}`, icon };
}

/** "200 m", "1.4 km" (or yards and miles): rounded the way a satnav says it. */
export const distanceText = (m: number) => formatMeters(m);

/** What the voice says: "In 200 metres, turn left onto High Street", or the instruction alone at the turn. */
export function spoken(step: Step | undefined, meters?: number) {
  const text = instruction(step).text;
  if (meters == null) return text;
  return `In ${spokenMeters(meters)}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/**
 * The index of the next maneuver ahead of the rider: steps the rider has reached are left behind. `from` is the
 * current index (it never goes back). Steps[0] is the departure point, so guidance starts at 1.
 */
export function nextStep(steps: Step[], from: number, position: Point) {
  let i = Math.max(1, from);
  while (i < steps.length - 1) {
    const at = stepPoint(steps[i]);
    if (at && metersBetween(position, at) > AT_TURN_METERS) break;
    i += 1;
  }
  return i;
}

/** Road distance (m) and time (s) left: to the next maneuver, then every step after it. */
export function remaining(steps: Step[], index: number, position: Point) {
  const at = stepPoint(steps[index]);
  const toTurn = at ? metersBetween(position, at) : 0;
  let meters = toTurn;
  let seconds = 0;
  for (let k = index; k < steps.length; k++) { meters += steps[k].distance; seconds += steps[k].duration; }
  // The part to the next maneuver is timed at the pace of the step before it.
  const before = steps[index - 1];
  if (before && before.distance > 0) seconds += (toTurn / before.distance) * before.duration;
  return { toTurn, meters, seconds };
}

/** How far the rider is from the route line (m), for "off route" detection. Flat-earth maths: fine over a few km. */
export function distanceToPath(position: Point, path: Point[]) {
  if (!path.length) return Infinity;
  const k = Math.cos((position.latitude * Math.PI) / 180) * 111320;
  const xy = (p: Point) => [(p.longitude - position.longitude) * k, (p.latitude - position.latitude) * 110540];
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = xy(path[i]);
    const [bx, by] = xy(path[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return path.length === 1 ? Math.hypot(...xy(path[0])) : best;
}

/** When to speak before a turn: earlier for a van (faster, bigger), then again just before it. */
export const announceAt = (vehicle: 'bike' | 'van') => (vehicle === 'van' ? { early: 300, now: 60 } : { early: 150, now: 30 });
