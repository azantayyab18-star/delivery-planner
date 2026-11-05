import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceText, distanceToPath, instruction, metersBetween, nextStep, remaining, spoken, type Step } from '../src/lib/guidance';

// A ride east along a street, a left turn 200 m on, then arrival 100 m north of it.
const at = (lon: number, lat: number): [number, number] => [lon, lat];
const steps: Step[] = [
  { distance: 200, duration: 50, name: 'Main Street', maneuver: { type: 'depart', location: at(-6.3, 53.3) } },
  { distance: 100, duration: 25, name: 'High Street', maneuver: { type: 'turn', modifier: 'left', location: at(-6.297, 53.3) } },
  { distance: 0, duration: 0, name: '', maneuver: { type: 'arrive', location: at(-6.297, 53.3009) } },
];

test('instructions read like a satnav', () => {
  assert.equal(instruction(steps[1]).text, 'Turn left onto High Street');
  assert.equal(instruction(steps[1]).icon, 'arrow-top-left');
  assert.equal(instruction({ distance: 0, duration: 0, name: 'Pearse St', maneuver: { type: 'roundabout', modifier: 'right', exit: 2 } }).text,
    'At the roundabout, take the 2nd exit onto Pearse St');
  assert.equal(instruction({ distance: 0, duration: 0, name: '', maneuver: { type: 'turn', modifier: 'slight right' } }).text, 'Bear right');
  assert.equal(instruction(steps[2]).text, 'Arrive at the stop');
});

test('the voice says the distance first, rounded', () => {
  assert.equal(spoken(steps[1], 148), 'In 150 metres, turn left onto High Street');
  assert.equal(spoken(steps[1]), 'Turn left onto High Street');
  assert.equal(distanceText(37), '40 m');
  assert.equal(distanceText(1450), '1.4 km');
});

test('turns are left behind once the rider reaches them, never going back', () => {
  const start = { latitude: 53.3, longitude: -6.3 };
  assert.equal(nextStep(steps, 1, start), 1);
  const atTurn = { latitude: 53.3, longitude: -6.29702 };
  assert.equal(nextStep(steps, 1, atTurn), 2);
  // Back near the start: the index stays where it was.
  assert.equal(nextStep(steps, 2, start), 2);
});

test('distance and time left follow the road steps', () => {
  const halfway = { latitude: 53.3, longitude: -6.2985 };
  const left = remaining(steps, 1, halfway);
  assert.ok(Math.abs(left.toTurn - metersBetween(halfway, { latitude: 53.3, longitude: -6.297 })) < 1);
  assert.ok(left.meters > 190 && left.meters < 210, String(left.meters));
  assert.ok(left.seconds > 45 && left.seconds < 55, String(left.seconds));
});

test('leaving the route line is noticed', () => {
  const path = [{ latitude: 53.3, longitude: -6.3 }, { latitude: 53.3, longitude: -6.297 }];
  assert.ok(distanceToPath({ latitude: 53.3, longitude: -6.2985 }, path) < 1);
  const off = distanceToPath({ latitude: 53.3006, longitude: -6.2985 }, path);
  assert.ok(off > 60 && off < 70, String(off));
});
