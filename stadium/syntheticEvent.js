import { BUILDINGS } from './pathNetwork.js';

const minute = 60;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const lerp = (a, b, fraction) => a + (b - a) * clamp(fraction, 0, 1);
const between = (a, b, fraction) => [lerp(a[0], b[0], fraction), lerp(a[1], b[1], fraction)];
const grandstand = BUILDINGS.find((building) => building.kind === 'grandstand')?.coordinates || [];
const bounds = {
  minLon: Math.min(...grandstand.map((point) => point[0])), maxLon: Math.max(...grandstand.map((point) => point[0])),
  minLat: Math.min(...grandstand.map((point) => point[1])), maxLat: Math.max(...grandstand.map((point) => point[1])),
};
function insideGrandstand(point) {
  let inside = false;
  for (let index = 0, prior = grandstand.length - 1; index < grandstand.length; prior = index++) {
    const a = grandstand[index];
    const b = grandstand[prior];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function seatPosition(random) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const position = [lerp(bounds.minLon, bounds.maxLon, random()), lerp(bounds.minLat, bounds.maxLat, random())];
    const inner = Math.hypot((position[0] + 73.84578) / .00068, (position[1] - 40.75703) / .00052);
    if (insideGrandstand(position) && inner > 1) return position;
  }
  return [-73.84665, 40.7568];
}

// Every route is an illustrative line on public imagery, not a venue floor plan.
export const ROUTES = Object.freeze({
  west: { name: 'West parking', mode: 'Parking', start: [-73.8502, 40.7560], approach: [-73.8481, 40.7563], gate: [-73.8469, 40.7568], concourse: [-73.8463, 40.7568] },
  south: { name: 'South parking', mode: 'Parking', start: [-73.8468, 40.7539], approach: [-73.8463, 40.7551], gate: [-73.8453, 40.7562], concourse: [-73.8454, 40.7567] },
  transit: { name: 'Transit approach', mode: 'Transit', start: [-73.8434, 40.7548], approach: [-73.8440, 40.7556], gate: [-73.8449, 40.7565], concourse: [-73.8453, 40.7568] },
  walk: { name: 'Walk-up approach', mode: 'Walk-up', start: [-73.8428, 40.7578], approach: [-73.8438, 40.7573], gate: [-73.8448, 40.7571], concourse: [-73.8453, 40.7571] },
});

export const VIEWPOINTS = Object.freeze({
  overview: { label: 'Overview', lon: -73.8457626, lat: 40.7570308, range: 1300, heading: 18, pitch: -66 },
  parking: { label: 'Parking', lon: -73.8481, lat: 40.7563, range: 260, heading: 18, pitch: -58 },
  entry: { label: 'Entry', lon: -73.8453, lat: 40.7562, range: 160, heading: 25, pitch: -58 },
  bowl: { label: 'Bowl', lon: -73.84578, lat: 40.75702, range: 190, heading: 12, pitch: -65 },
  venue3d: { label: '3D venue', lon: -73.84578, lat: 40.75702, range: 300, heading: 205, pitch: -50 },
});

function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

function routeKey(roll) {
  if (roll < .25) return 'west';
  if (roll < .48) return 'south';
  if (roll < .76) return 'transit';
  return 'walk';
}

function money(amount) { return Math.round(amount * 100) / 100; }

export function createSyntheticEvent({ kind = 'game', groupCount = 280, seed = 5104 } = {}) {
  const random = randomGenerator(seed + (kind === 'show' ? 901 : 0));
  const count = clamp(Math.round(Number(groupCount) || 280), 50, 500);
  const groups = [];
  const transactions = [];
  const isShow = kind === 'show';
  for (let index = 0; index < count; index += 1) {
    const route = routeKey(random());
    const spec = ROUTES[route];
    const id = `G${String(index + 1).padStart(3, '0')}`;
    const party = 1 + Math.floor(random() * 5);
    const arrival = (-88 + (random() + random()) * (isShow ? 53 : 48)) * minute;
    const offset = [(random() - .5) * .0003, (random() - .5) * .00023];
    const jitter = (point, scale = 1) => [point[0] + offset[0] * scale, point[1] + offset[1] * scale];
    const seat = seatPosition(random);
    const snackTime = 10 * minute + random() * 24 * minute;
    const hasFood = random() < (isShow ? .70 : .64);
    const hasMerch = random() < (isShow ? .34 : .19);
    const group = {
      id, party, route, arrival, snackTime, hasFood, hasMerch,
      start: jitter(spec.start, 2), approach: jitter(spec.approach), gate: jitter(spec.gate, .35),
      concourse: jitter(spec.concourse, .5), seat,
    };
    groups.push(group);
    const add = (type, time, zone, amount, method) => transactions.push({
      id: `${id}-${type.toLowerCase().replace(/\s+/g, '-')}`,
      groupId: id, party, type, time, zone, amount: money(amount), method, source: 'Synthetic',
    });
    if (spec.mode === 'Parking') add('Parking', arrival + 7 * minute, spec.name, 28 + Math.floor(random() * 5) * 5, random() < .65 ? 'Tap' : 'Card');
    add('Gate scan', arrival + 18 * minute, `${spec.name} gate`, 0, 'Ticket');
    if (hasFood) add('Concessions', Math.max(arrival + 28 * minute, snackTime + 2 * minute), 'Concourse', 9 + Math.floor(random() * 10) * 4 + party * 2, random() < .7 ? 'Tap' : 'Card');
    if (hasMerch) add('Merchandise', Math.max(arrival + 31 * minute, 13 * minute + random() * 25 * minute), 'Concourse', 25 + Math.floor(random() * 9) * 8, random() < .8 ? 'Tap' : 'Card');
  }
  transactions.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  return { kind, groups, transactions, people: groups.reduce((sum, group) => sum + group.party, 0), firstTime: -90 * minute, lastTime: 90 * minute };
}

export function groupAt(group, time) {
  const elapsed = time - group.arrival;
  if (elapsed < 0) return { stage: 'not arrived', position: null };
  if (group.unreachable) return { stage: 'blocked', position: group.path?.[0] || null };
  if (group.path?.length) {
    if (time < group.pathStart) return { stage: 'parking', position: group.path[0] };
    if (time < group.pathArrive) {
      const distance = group.pathDistance * (time - group.pathStart) / (group.pathArrive - group.pathStart);
      const last = group.pathLengths.length - 1;
      let index = 0;
      while (index < last - 1 && group.pathLengths[index + 1] < distance) index += 1;
      const span = group.pathLengths[index + 1] - group.pathLengths[index] || 1;
      return { stage: 'approaching', position: between(group.path[index], group.path[index + 1], (distance - group.pathLengths[index]) / span), edgeId: group.pathEdges[index] };
    }
    if (time < group.entryTime) return { stage: 'queue', position: group.path.at(-1) };
    const admitted = time - group.entryTime;
    if (admitted < 2 * minute) return { stage: 'admitted', position: between(group.path.at(-1), group.concourse, admitted / (2 * minute)) };
    if (admitted < 8 * minute) return { stage: 'concourse', position: between(group.concourse, group.seat, (admitted - 2 * minute) / (6 * minute)) };
    if (group.hasFood && time >= Math.max(group.snackTime, group.entryTime + 8 * minute) && time < Math.max(group.snackTime, group.entryTime + 8 * minute) + 5 * minute) {
      const fraction = (time - Math.max(group.snackTime, group.entryTime + 8 * minute)) / (5 * minute);
      return { stage: 'concourse', position: fraction < .5 ? between(group.seat, group.concourse, fraction * 2) : between(group.concourse, group.seat, (fraction - .5) * 2) };
    }
    return { stage: 'seated', position: group.seat };
  }
  const parking = ROUTES[group.route].mode === 'Parking';
  if (elapsed < 6 * minute) return { stage: 'approaching', position: between(group.start, group.approach, elapsed / (6 * minute)) };
  if (elapsed < 10 * minute) return { stage: parking ? 'parking' : 'approaching', position: between(group.approach, group.gate, (elapsed - 6 * minute) / (10 * minute)) };
  if (elapsed < 17 * minute) return { stage: 'queue', position: between(group.gate, group.concourse, .05 + (elapsed - 10 * minute) / (7 * minute) * .13) };
  if (elapsed < 19 * minute) return { stage: 'admitted', position: between(group.gate, group.concourse, (elapsed - 17 * minute) / (2 * minute)) };
  if (elapsed < 25 * minute) return { stage: 'concourse', position: between(group.concourse, group.seat, (elapsed - 19 * minute) / (6 * minute)) };
  if (group.hasFood && time >= group.snackTime && time < group.snackTime + 5 * minute) {
    const fraction = (time - group.snackTime) / (5 * minute);
    return { stage: 'concourse', position: fraction < .5 ? between(group.seat, group.concourse, fraction * 2) : between(group.concourse, group.seat, (fraction - .5) * 2) };
  }
  return { stage: 'seated', position: group.seat };
}

export function eventSnapshot(event, time) {
  const counts = { approaching: 0, parking: 0, queue: 0, admitted: 0, concourse: 0, seated: 0, blocked: 0 };
  let cars = 0;
  for (const group of event.groups) {
    const state = groupAt(group, time);
    if (state.stage in counts) counts[state.stage] += group.party;
    if (ROUTES[group.route].mode === 'Parking' && time >= group.arrival + 7 * minute) cars += 1;
  }
  const transactions = event.transactions.filter((transaction) => transaction.time <= time);
  const paid = transactions.filter((transaction) => transaction.amount > 0);
  return { counts, cars, transactions, people: event.people, admitted: counts.admitted + counts.concourse + counts.seated, spend: money(paid.reduce((sum, transaction) => sum + transaction.amount, 0)) };
}

export function formatEventTime(time) {
  const sign = time < 0 ? '-' : '+';
  const seconds = Math.round(Math.abs(time));
  return `T${sign}${String(Math.floor(seconds / minute)).padStart(2, '0')}:${String(seconds % minute).padStart(2, '0')}`;
}
