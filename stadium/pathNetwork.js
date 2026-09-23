import snapshot from './data/citi-osm.json' with { type: 'json' };

export const ORIGINS = Object.freeze({ west: '2297476925', south: '11237681603', transit: '3380027698', walk: '8569042987' });
export const GATES = Object.freeze({ west: { node: '8951447963', name: 'West perimeter' }, south: { node: '8951447951', name: 'South perimeter' }, east: { node: '8951447950', name: 'East perimeter' } });
export const DEFAULT_RULES = Object.freeze({ gatePolicy: 'nearest', capacity: 12, avoidSteps: true, closedGates: [], routeTemplateId: 'nearest', originNodes: {}, gateNodes: {}, groupStartNodes: {} });
export const ROUTE_TEMPLATES = Object.freeze([
  { id: 'nearest', name: 'Nearest entry', origin: null, gate: null },
  { id: 'west-south', name: 'West lot to south entry', origin: 'west', gate: 'south' },
  { id: 'south-east', name: 'South lot to east entry', origin: 'south', gate: 'east' },
  { id: 'transit-west', name: 'Transit to west entry', origin: 'transit', gate: 'west' },
  { id: 'walk-south', name: 'Walk-up to south entry', origin: 'walk', gate: 'south' },
]);
export const TEMPLATES = Object.freeze([
  { id: 'open', name: 'Open flow', rules: { gatePolicy: 'nearest', capacity: 12, avoidSteps: true, closedGates: [] }, barrierGate: null },
  { id: 'balanced', name: 'Balance entrances', rules: { gatePolicy: 'balanced', capacity: 12, avoidSteps: true, closedGates: [] }, barrierGate: null },
  { id: 'west-close', name: 'Close west entry', rules: { gatePolicy: 'nearest', capacity: 12, avoidSteps: true, closedGates: ['west'] }, barrierGate: 'west' },
  { id: 'south-close', name: 'Close south entry', rules: { gatePolicy: 'nearest', capacity: 12, avoidSteps: true, closedGates: ['south'] }, barrierGate: 'south' },
  { id: 'slow', name: 'Slow screening', rules: { gatePolicy: 'nearest', capacity: 6, avoidSteps: true, closedGates: [] }, barrierGate: null },
]);

export const PATH_SOURCE = snapshot.source;
export const BUILDINGS = snapshot.buildings;
export const NETWORK_NODES = snapshot.nodes;

function meters(a, b) {
  const longitude = (a[0] - b[0]) * 85000;
  const latitude = (a[1] - b[1]) * 111000;
  return Math.hypot(longitude, latitude);
}

const edges = [];
const adjacency = new Map();
for (const way of snapshot.ways) {
  for (let index = 0; index < way.nodes.length - 1; index += 1) {
    const from = way.nodes[index];
    const to = way.nodes[index + 1];
    const a = NETWORK_NODES[from];
    const b = NETWORK_NODES[to];
    if (!a || !b) continue;
    const edge = { id: `${way.id}:${index}`, from, to, a, b, kind: way.kind, detail: way.detail, name: way.name, distance: meters(a, b) };
    edges.push(edge);
    for (const [node, neighbor] of [[from, to], [to, from]]) {
      if (!adjacency.has(node)) adjacency.set(node, []);
      adjacency.get(node).push({ node: neighbor, edge });
    }
  }
}
export const NETWORK_EDGES = Object.freeze(edges);

export function nearestEdge(position) {
  let nearest = null;
  let best = Number.POSITIVE_INFINITY;
  for (const edge of edges) {
    const ax = (edge.a[0] - position[0]) * 85000;
    const ay = (edge.a[1] - position[1]) * 111000;
    const bx = (edge.b[0] - position[0]) * 85000;
    const by = (edge.b[1] - position[1]) * 111000;
    const dx = bx - ax;
    const dy = by - ay;
    const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const distance = Math.hypot(ax + fraction * dx, ay + fraction * dy);
    if (distance < best) {
      best = distance;
      nearest = { edge, distance, position: [edge.a[0] + (edge.b[0] - edge.a[0]) * fraction, edge.a[1] + (edge.b[1] - edge.a[1]) * fraction] };
    }
  }
  return nearest;
}

export function nearestNode(position) {
  let nearest = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const [id, point] of Object.entries(NETWORK_NODES)) {
    const candidate = meters(position, point);
    if (candidate < distance) { nearest = { id, position: point, distance: candidate }; distance = candidate; }
  }
  return nearest;
}

function shortestPath(start, end, rules, activeBarriers, parkingOrigin = false) {
  const blocked = new Set(activeBarriers.filter((item) => item.kind === 'closed').map((item) => item.edgeId));
  const delayed = new Set(activeBarriers.filter((item) => item.kind === 'slow').map((item) => item.edgeId));
  const distance = new Map([[start, 0]]);
  const previous = new Map();
  const unsettled = new Set([start]);
  while (unsettled.size) {
    let node;
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of unsettled) if (distance.get(candidate) < best) { node = candidate; best = distance.get(candidate); }
    if (node === end) break;
    unsettled.delete(node);
    for (const next of adjacency.get(node) || []) {
      if (blocked.has(next.edge.id) || (rules.avoidSteps && next.edge.kind === 'steps')) continue;
      const aisleWeight = next.edge.kind === 'parking_aisle' ? (parkingOrigin ? 1.3 : 3) : 1;
      const cost = next.edge.distance * aisleWeight * (delayed.has(next.edge.id) ? 5 : 1);
      const alt = best + cost;
      if (alt < (distance.get(next.node) ?? Number.POSITIVE_INFINITY)) {
        distance.set(next.node, alt);
        previous.set(next.node, { node, edge: next.edge });
        unsettled.add(next.node);
      }
    }
  }
  if (!distance.has(end)) return null;
  const nodeIds = [end];
  const edgeIds = [];
  for (let node = end; node !== start;) {
    const step = previous.get(node);
    if (!step) return null;
    nodeIds.unshift(step.node);
    edgeIds.unshift(step.edge.id);
    node = step.node;
  }
  const coords = nodeIds.map((id) => NETWORK_NODES[id]);
  const delayDistance = edgeIds.reduce((sum, id) => sum + (delayed.has(id) ? edges.find((edge) => edge.id === id)?.distance || 0 : 0), 0);
  let actualDistance = 0;
  const lengths = [0];
  for (let index = 1; index < coords.length; index += 1) {
    actualDistance += meters(coords[index - 1], coords[index]);
    lengths.push(actualDistance);
  }
  return { nodeIds, edgeIds, coords, lengths, distance: actualDistance, delayDistance, cost: distance.get(end) };
}

export function planEvent(baseEvent, rules = DEFAULT_RULES, barriers = []) {
  const activeBarriers = barriers.filter((item) => !item.archived);
  const candidates = new Map();
  const routeTemplate = ROUTE_TEMPLATES.find((item) => item.id === rules.routeTemplateId);
  const getPath = (start, gate, parking) => {
    const destination = rules.gateNodes?.[gate] || GATES[gate].node;
    const key = `${start}:${destination}:${parking}`;
    if (!candidates.has(key)) candidates.set(key, shortestPath(start, destination, rules, activeBarriers, parking));
    return candidates.get(key);
  };
  const load = Object.fromEntries(Object.keys(GATES).map((gate) => [gate, 0]));
  const flow = new Map();
  const drafts = [...baseEvent.groups].sort((a, b) => a.arrival - b.arrival).map((group) => {
    const startNode = rules.groupStartNodes?.[group.id] || rules.originNodes?.[group.route] || ORIGINS[group.route];
    const parking = group.route === 'west' || group.route === 'south';
    const choices = Object.keys(GATES).filter((gate) => !rules.closedGates?.includes(gate)).map((gate) => ({ gate, path: getPath(startNode, gate, parking) })).filter((item) => item.path);
    if (!choices.length) return { ...group, unreachable: true, path: [NETWORK_NODES[startNode]] };
    choices.sort((a, b) => {
      const score = (item) => item.path.cost + (rules.gatePolicy === 'balanced' ? load[item.gate] * 4 : 0) + (['west', 'south', 'east'].includes(rules.gatePolicy) && rules.gatePolicy !== item.gate ? 260 : 0) + (routeTemplate?.origin === group.route && routeTemplate.gate !== item.gate ? 100000 : 0);
      return score(a) - score(b);
    });
    const chosen = choices[0];
    const path = chosen.path;
    const pathStart = group.arrival + (parking ? 7 * 60 : 0);
    const walkSeconds = Math.max(30, (path.distance + path.delayDistance * 4) / 1.25);
    const pathArrive = pathStart + walkSeconds;
    load[chosen.gate] += group.party;
    path.edgeIds.forEach((id) => flow.set(id, (flow.get(id) || 0) + group.party));
    return { ...group, gateId: chosen.gate, gate: NETWORK_NODES[rules.gateNodes?.[chosen.gate] || GATES[chosen.gate].node], path: path.coords, pathLengths: path.lengths, pathEdges: path.edgeIds, pathDistance: path.distance, pathStart, pathArrive, walkSeconds };
  });
  const availableAt = Object.fromEntries(Object.keys(GATES).map((gate) => [gate, baseEvent.firstTime]));
  const groups = drafts.sort((a, b) => (a.pathArrive ?? Number.POSITIVE_INFINITY) - (b.pathArrive ?? Number.POSITIVE_INFINITY)).map((group) => {
    if (group.unreachable) return group;
    const serviceStart = Math.max(group.pathArrive + 3 * 60, availableAt[group.gateId]);
    const entryTime = serviceStart + group.party / Math.max(1, Number(rules.capacity) || 12) * 60;
    availableAt[group.gateId] = entryTime;
    return { ...group, entryTime, waitSeconds: entryTime - group.pathArrive };
  });
  const byId = new Map(groups.map((group) => [group.id, group]));
  const transactions = baseEvent.transactions.filter((entry) => !byId.get(entry.groupId)?.unreachable).map((entry) => {
    const group = byId.get(entry.groupId);
    if (entry.type === 'Gate scan') return { ...entry, time: group.entryTime, zone: GATES[group.gateId].name };
    if (entry.type === 'Concessions') return { ...entry, time: Math.max(group.entryTime + 7 * 60, entry.time) };
    if (entry.type === 'Merchandise') return { ...entry, time: Math.max(group.entryTime + 9 * 60, entry.time) };
    return entry;
  }).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const reachable = groups.filter((group) => !group.unreachable);
  return { ...baseEvent, groups, transactions, flow, unreachable: groups.length - reachable.length, averageWalk: reachable.reduce((sum, group) => sum + group.walkSeconds * group.party, 0) / (reachable.reduce((sum, group) => sum + group.party, 0) || 1), averageWait: reachable.reduce((sum, group) => sum + group.waitSeconds * group.party, 0) / (reachable.reduce((sum, group) => sum + group.party, 0) || 1), gateLoad: load };
}

export function gateBarrier(gate, gateNode = GATES[gate].node) {
  const source = Object.keys(ORIGINS).find((origin) => origin === gate) || 'walk';
  const path = shortestPath(ORIGINS[source], gateNode, DEFAULT_RULES, [], source === 'west' || source === 'south');
  const edgeId = path?.edgeIds.at(-1);
  const edge = edges.find((item) => item.id === edgeId);
  if (!edge) return null;
  return { id: `template-${gate}`, name: `${GATES[gate].name} closure`, edgeId, kind: 'gate', color: '#ef5b5b', position: [(edge.a[0] + edge.b[0]) / 2, (edge.a[1] + edge.b[1]) / 2], archived: false, template: true };
}
